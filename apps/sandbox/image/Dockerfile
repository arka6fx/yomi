# Yomi computer image: Cloudflare sandbox base + Linux desktop stack.
#
# Extends the version-pinned sandbox base (keep ENTRYPOINT; the sandbox
# binary starts its control plane, then runs our CMD). The desktop
# (Xvfb + window manager + Chromium + VNC) and the agent control service
# all start from startup.sh. BASE_TAG must match @cloudflare/sandbox in
# package.json (see docs: never mix preview package with stable image).
ARG BASE_TAG=0.13.0-next.751.1
FROM docker.io/cloudflare/sandbox:${BASE_TAG}-python

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    YOMI_DESKTOP_WIDTH=1280 \
    YOMI_DESKTOP_HEIGHT=800

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    openbox \
    scrot \
    xdotool \
    wmctrl \
    squashfs-tools \
    procps \
    fonts-dejavu-core \
    fonts-liberation \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu ships no Chromium deb (snap-only); install Google Chrome directly.
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/* \
    && google-chrome --version

# Playwright's client only: it attaches to the desktop's Chrome over DevTools,
# so no bundled browsers are downloaded.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    playwright==1.63.0 websockify==0.13.0

COPY control/ /opt/yomi/control/
COPY startup.sh /opt/yomi/startup.sh
RUN chmod +x /opt/yomi/startup.sh

EXPOSE 5900 6080 8081

CMD ["/opt/yomi/startup.sh"]
