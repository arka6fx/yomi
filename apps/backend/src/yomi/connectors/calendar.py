"""Google Calendar connector.

Ported from `packages/agent-core/src/connectors/google-calendar-def.ts`.
Provider key in `mcp_connections` is `google-calendar`. Exposes 10 tools;
writes are gated through `gate_write` and offset-less times are anchored to the
user's own calendar timezone.
"""

from __future__ import annotations

import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from yomi.connectors.base import (
    IRREVERSIBLE,
    WRITE,
    ConnectorContext,
    ConnectorDef,
    ConnectorError,
    ConnectorTool,
    connector_error,
    gate_write,
)

_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
_HAS_OFFSET = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")
_LOCAL_TIME_HINT = (
    "Pass the user's local wall-clock time WITHOUT a UTC offset (e.g. 2026-07-01T14:00:00) — it is "
    "interpreted in the user's own calendar timezone automatically. Never convert to UTC or assume a "
    "timezone; only include an explicit offset if the user names one."
)


def _to_localtime(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%I:%M %p").lstrip("0")
    except ValueError:
        return iso


def event_time_payload(date_time: str, tz: str | None) -> dict:
    """Anchor an event start/end to the user's calendar timezone when no offset is given."""
    if _HAS_OFFSET.search(date_time):
        return {"dateTime": date_time}
    if tz:
        return {"dateTime": date_time, "timeZone": tz}
    return {"dateTime": date_time}


def _gate_meta(*, action: str, risk: str, title: str, preview: str, confirm_text: str) -> dict:
    return {
        "connector": "google-calendar",
        "action": action,
        "risk": risk,
        "title": title,
        "preview": preview,
        "confirm_text": confirm_text,
    }


def _spec(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


def create_calendar_tools(ctx: ConnectorContext) -> dict[str, ConnectorTool]:
    async def calendar(
        path: str, *, method: str = "GET", json_: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        token = await ctx.get_access_token(ctx.user_id, "google-calendar")
        headers = {"Authorization": f"Bearer {token}"}
        if json_ is not None:
            headers["Content-Type"] = "application/json"
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.request(
                method, f"{_CALENDAR_BASE}{path}", headers=headers, json=json_, params=params
            )
        if res.status_code >= 400:
            raise ConnectorError(f"Calendar API {path} → {res.status_code}: {res.text[:200]}")
        if res.status_code == 204 or not res.text:
            return None
        return res.json()

    async def user_time_zone() -> str | None:
        try:
            data = await calendar("/users/me/settings/timezone")
            return (data or {}).get("value")
        except ConnectorError:
            return None

    async def event_time(date_time: str) -> dict:
        tz = None
        if not _HAS_OFFSET.search(date_time):
            tz = await user_time_zone()
        return event_time_payload(date_time, tz)

    async def list_events(args: dict) -> dict:
        try:
            now = datetime.now(UTC)
            end = now + timedelta(days=int(args.get("days") or 7))
            data = await calendar(
                "/calendars/primary/events",
                params={
                    "timeMin": now.isoformat(),
                    "timeMax": end.isoformat(),
                    "maxResults": str(int(args.get("maxResults") or 20)),
                    "singleEvents": "true",
                    "orderBy": "startTime",
                },
            )
            events = [
                {
                    "id": event.get("id"),
                    "title": event.get("summary") or "(No title)",
                    "start": (event.get("start") or {}).get("dateTime")
                    or (event.get("start") or {}).get("date")
                    or "",
                    "end": (event.get("end") or {}).get("dateTime")
                    or (event.get("end") or {}).get("date")
                    or "",
                    "location": event.get("location"),
                    "description": str(event.get("description") or "")[:500],
                }
                for event in (data or {}).get("items") or []
            ]
            if not events:
                return {"events": [], "message": "No events found in this time range."}
            return {"count": len(events), "events": events}
        except Exception as err:
            return connector_error(err)

    async def get_event(args: dict) -> dict:
        try:
            event_id = str(args["eventId"])
            event = await calendar(f"/calendars/primary/events/{event_id}")
            return {
                "id": event.get("id"),
                "title": event.get("summary") or "(No title)",
                "start": (event.get("start") or {}).get("dateTime")
                or (event.get("start") or {}).get("date")
                or "",
                "end": (event.get("end") or {}).get("dateTime")
                or (event.get("end") or {}).get("date")
                or "",
                "location": event.get("location"),
                "description": event.get("description"),
                "attendees": [
                    {"email": guest.get("email"), "name": guest.get("displayName"), "status": guest.get("responseStatus")}
                    for guest in event.get("attendees") or []
                ],
                "link": event.get("htmlLink"),
            }
        except Exception as err:
            return connector_error(err)

    async def find_free_time(args: dict) -> dict:
        try:
            date = str(args["date"])
            day_start = datetime.fromisoformat(f"{date}T06:00:00").replace(tzinfo=UTC)
            day_end = datetime.fromisoformat(f"{date}T22:00:00").replace(tzinfo=UTC)
            data = await calendar(
                "/freeBusy",
                method="POST",
                json_={
                    "timeMin": day_start.isoformat(),
                    "timeMax": day_end.isoformat(),
                    "items": [{"id": "primary"}],
                },
            )
            busy = ((data or {}).get("calendars") or {}).get("primary", {}).get("busy") or []
            return {
                "date": date,
                "workingHours": "6:00 AM – 10:00 PM",
                "busySlots": [{"start": _to_localtime(slot["start"]), "end": _to_localtime(slot["end"])} for slot in busy],
                "message": (
                    "No busy slots found — the day appears free."
                    if not busy
                    else f"{len(busy)} busy slot(s) found."
                ),
            }
        except Exception as err:
            return connector_error(err)

    async def create_event(args: dict) -> dict:
        async def run() -> dict:
            try:
                event = await calendar(
                    "/calendars/primary/events",
                    method="POST",
                    json_={
                        "summary": args["title"],
                        "start": await event_time(args["start"]),
                        "end": await event_time(args["end"]),
                        "description": args.get("description"),
                        "location": args.get("location"),
                        "attendees": [{"email": email} for email in args.get("attendees") or []],
                    },
                )
                return {
                    "ok": True,
                    "eventId": event.get("id"),
                    "link": event.get("htmlLink"),
                    "message": f'Event "{args["title"]}" created.',
                }
            except Exception as err:
                return connector_error(err)

        attendees = args.get("attendees") or []
        preview = (
            f"{args.get('title')}\n{args.get('start')} – {args.get('end')}"
            + (f"\nAttendees: {', '.join(attendees)}" if attendees else "")
            + (f"\nLocation: {args.get('location')}" if args.get("location") else "")
        )
        return await gate_write(
            ctx,
            _gate_meta(
                action="calendar-createEvent",
                risk=WRITE,
                title=f"Create calendar event: {args.get('title')}",
                preview=preview,
                confirm_text="Create event",
            ),
            args,
            run,
        )

    async def update_event(args: dict) -> dict:
        async def run() -> dict:
            try:
                patch: dict[str, Any] = {}
                if args.get("title") is not None:
                    patch["summary"] = args["title"]
                if args.get("start") is not None:
                    patch["start"] = await event_time(args["start"])
                if args.get("end") is not None:
                    patch["end"] = await event_time(args["end"])
                if args.get("description") is not None:
                    patch["description"] = args["description"]
                if args.get("location") is not None:
                    patch["location"] = args["location"]
                event = await calendar(
                    f"/calendars/primary/events/{args['eventId']}", method="PATCH", json_=patch
                )
                return {
                    "ok": True,
                    "eventId": event.get("id"),
                    "link": event.get("htmlLink"),
                    "message": "Event updated.",
                }
            except Exception as err:
                return connector_error(err)

        preview = "\n".join(
            part
            for part in (
                f"Title: {args['title']}" if args.get("title") else None,
                f"Start: {args['start']}" if args.get("start") else None,
                f"End: {args['end']}" if args.get("end") else None,
                f"Location: {args['location']}" if args.get("location") else None,
            )
            if part is not None
        )
        return await gate_write(
            ctx,
            _gate_meta(
                action="calendar-updateEvent",
                risk=WRITE,
                title=f"Update calendar event {args['eventId']}",
                preview=preview,
                confirm_text="Update event",
            ),
            args,
            run,
        )

    async def delete_event(args: dict) -> dict:
        async def run() -> dict:
            try:
                await calendar(f"/calendars/primary/events/{args['eventId']}", method="DELETE")
                return {"ok": True, "message": f"Event {args['eventId']} deleted."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="calendar-deleteEvent",
                risk=IRREVERSIBLE,
                title=f"Delete calendar event {args['eventId']}",
                preview=f"Delete event {args['eventId']}",
                confirm_text="Delete event",
            ),
            args,
            run,
        )

    async def list_calendars(args: dict) -> dict:
        try:
            data = await calendar("/users/me/calendarList")
            calendars = [
                {
                    "id": cal.get("id"),
                    "name": cal.get("summary") or "(No title)",
                    "description": cal.get("description"),
                    "primary": bool(cal.get("primary")),
                }
                for cal in (data or {}).get("items") or []
            ]
            if not calendars:
                return {"calendars": [], "message": "No calendars found."}
            return {"count": len(calendars), "calendars": calendars}
        except Exception as err:
            return connector_error(err)

    async def quick_add(args: dict) -> dict:
        async def run() -> dict:
            try:
                cal = str(args.get("calendarId") or "primary")
                event = await calendar(
                    f"/calendars/{cal}/events/quickAdd",
                    method="POST",
                    params={"sendNotifications": "true"},
                    json_={"text": args["text"]},
                )
                return {
                    "ok": True,
                    "eventId": event.get("id"),
                    "title": event.get("summary"),
                    "link": event.get("htmlLink"),
                    "message": f'Event "{event.get("summary")}" created.',
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="calendar-quickAdd",
                risk=WRITE,
                title="Quick add calendar event",
                preview=args.get("text", ""),
                confirm_text="Quick add",
            ),
            args,
            run,
        )

    async def get_calendar(args: dict) -> dict:
        try:
            cal = str(args.get("calendarId") or "primary")
            data = await calendar(f"/calendars/{cal}")
            return {
                "id": data.get("id"),
                "name": data.get("summary"),
                "description": data.get("description") or None,
                "timezone": data.get("timeZone") or None,
                "accessRole": data.get("accessRole") or None,
                "backgroundColor": data.get("backgroundColor") or None,
                "primary": bool(data.get("primary")),
            }
        except Exception as err:
            return connector_error(err)

    async def create_event_with_meet(args: dict) -> dict:
        async def run() -> dict:
            try:
                cal = str(args.get("calendarId") or "primary")
                event = await calendar(
                    f"/calendars/{cal}/events",
                    method="POST",
                    params={"conferenceDataVersion": "1"},
                    json_={
                        "summary": args["title"],
                        "start": await event_time(args["start"]),
                        "end": await event_time(args["end"]),
                        "description": args.get("description"),
                        "location": args.get("location"),
                        "attendees": [{"email": email} for email in args.get("attendees") or []],
                        "conferenceData": {
                            "createRequest": {
                                "requestId": f"yomi-{int(time.time() * 1000)}",
                                "conferenceSolutionKey": {"type": "hangoutsMeet"},
                            }
                        },
                    },
                )
                meet_link = None
                for entry in (event.get("conferenceData") or {}).get("entryPoints") or []:
                    if entry.get("uri"):
                        meet_link = entry.get("uri")
                        break
                return {
                    "ok": True,
                    "eventId": event.get("id"),
                    "link": event.get("htmlLink"),
                    "meetLink": meet_link,
                    "message": f'Event "{args["title"]}" created with Google Meet.',
                }
            except Exception as err:
                return connector_error(err)

        attendees = args.get("attendees") or []
        preview = (
            f"{args.get('title')}\n{args.get('start')} – {args.get('end')}\nGoogle Meet video "
            "conferencing"
            + (f"\nAttendees: {', '.join(attendees)}" if attendees else "")
            + (f"\nLocation: {args.get('location')}" if args.get("location") else "")
        )
        return await gate_write(
            ctx,
            _gate_meta(
                action="calendar-createEventWithMeet",
                risk=WRITE,
                title=f"Create calendar event with Meet: {args.get('title')}",
                preview=preview,
                confirm_text="Create event with Meet",
            ),
            args,
            run,
        )

    return {
        "calendar-listEvents": ConnectorTool(
            name="calendar-listEvents",
            description=(
                "List upcoming calendar events. Returns events from the user's primary Google "
                "Calendar within the specified time range."
            ),
            parameters=_spec(
                {
                    "days": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Number of days ahead to look (default: 7)"},
                    "maxResults": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Max events to return"},
                },
            ),
            execute=list_events,
        ),
        "calendar-getEvent": ConnectorTool(
            name="calendar-getEvent",
            description="Get details for a specific calendar event by its ID.",
            parameters=_spec({"eventId": {"type": "string", "description": "Google Calendar event ID"}}),
            execute=get_event,
        ),
        "calendar-findFreeTime": ConnectorTool(
            name="calendar-findFreeTime",
            description=(
                "Find free time slots in the user's calendar. Useful for scheduling. Returns busy "
                "periods and implied free windows."
            ),
            parameters=_spec(
                {"date": {"type": "string", "description": "Date to check in YYYY-MM-DD format (checks 6am–10pm that day)"}},
            ),
            execute=find_free_time,
        ),
        "calendar-createEvent": ConnectorTool(
            name="calendar-createEvent",
            description=(
                f"Create a new event on the user's primary Google Calendar. {_LOCAL_TIME_HINT} If the "
                "user named a guest by name rather than address (\"lunch with Priya\"), ask the user "
                "for their email address before adding them as an attendee — never guess an address. "
                "Call this directly when the user asks to schedule — the system holds it for their "
                "approval automatically, so do not ask them to confirm first."
            ),
            parameters=_spec(
                {
                    "title": {"type": "string", "description": "Event title / summary"},
                    "start": {"type": "string", "description": "Start datetime in the user's local time, e.g. 2026-07-01T14:00:00 (no offset)"},
                    "end": {"type": "string", "description": "End datetime in the user's local time (no offset)"},
                    "description": {"type": "string", "description": "Event description / notes"},
                    "location": {"type": "string", "description": "Event location"},
                    "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee email addresses to invite"},
                },
                ["title", "start", "end"],
            ),
            execute=create_event,
        ),
        "calendar-updateEvent": ConnectorTool(
            name="calendar-updateEvent",
            description=(
                "Update an existing calendar event. Only the fields you pass are changed. Get the "
                "eventId from calendar-listEvents first, and confirm the changes with the user."
            ),
            parameters=_spec(
                {
                    "eventId": {"type": "string", "description": "Google Calendar event ID to update"},
                    "title": {"type": "string", "description": "New title / summary"},
                    "start": {"type": "string", "description": "New start datetime in the user's local time (no offset)"},
                    "end": {"type": "string", "description": "New end datetime in the user's local time (no offset)"},
                    "description": {"type": "string", "description": "New description"},
                    "location": {"type": "string", "description": "New location"},
                },
                ["eventId"],
            ),
            execute=update_event,
        ),
        "calendar-deleteEvent": ConnectorTool(
            name="calendar-deleteEvent",
            description=(
                "Delete a calendar event by ID. IMPORTANT: Always confirm with the user before "
                "calling this — the event is removed from the calendar."
            ),
            parameters=_spec({"eventId": {"type": "string", "description": "Google Calendar event ID to delete"}}),
            execute=delete_event,
        ),
        "calendar-listCalendars": ConnectorTool(
            name="calendar-listCalendars",
            description=(
                "List all calendars the user has access to, including the primary calendar and any "
                "secondary calendars they've created or subscribed to."
            ),
            parameters=_spec({}),
            execute=list_calendars,
        ),
        "calendar-quickAdd": ConnectorTool(
            name="calendar-quickAdd",
            description=(
                "Quickly create a calendar event using natural language text. Google Calendar parses "
                "the text to extract title, date, time, and duration. Example: 'Lunch with Sarah "
                "tomorrow at 1pm for 1 hour'."
            ),
            parameters=_spec(
                {
                    "text": {"type": "string", "description": "Natural language event description, e.g. 'Meeting with John next Tuesday at 2pm'"},
                    "calendarId": {"type": "string", "description": "Calendar ID (defaults to primary)"},
                },
                ["text"],
            ),
            execute=quick_add,
        ),
        "calendar-getCalendar": ConnectorTool(
            name="calendar-getCalendar",
            description=(
                "Get metadata for a specific Google Calendar by ID, including its name, description, "
                "timezone, and access role."
            ),
            parameters=_spec({"calendarId": {"type": "string", "description": "Calendar ID (defaults to primary)"}}),
            execute=get_calendar,
        ),
        "calendar-createEventWithMeet": ConnectorTool(
            name="calendar-createEventWithMeet",
            description=(
                f"Create a new event on a Google Calendar with a Google Meet video conferencing link "
                f"attached. {_LOCAL_TIME_HINT} Call this directly when the user asks to schedule — the "
                "system holds it for their approval automatically, so do not ask them to confirm first."
            ),
            parameters=_spec(
                {
                    "calendarId": {"type": "string", "description": "Calendar ID to create the event in (defaults to primary)"},
                    "title": {"type": "string", "description": "Event title / summary"},
                    "start": {"type": "string", "description": "Start datetime in the user's local time, e.g. 2026-07-01T14:00:00 (no offset)"},
                    "end": {"type": "string", "description": "End datetime in the user's local time (no offset)"},
                    "description": {"type": "string", "description": "Event description / notes"},
                    "location": {"type": "string", "description": "Event location"},
                    "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee email addresses to invite"},
                },
                ["title", "start", "end"],
            ),
            execute=create_event_with_meet,
        ),
    }


google_calendar_def: ConnectorDef = ConnectorDef(
    id="google-calendar",
    name="Google Calendar",
    category="productivity",
    icon="google-calendar",
    description=(
        "View events, check availability, and create, edit, or delete events on your Google Calendar."
    ),
    tools=create_calendar_tools,
)