#!/usr/bin/env bash
# Open an SSH tunnel to the prod RDS PostgreSQL instance via the EC2 box.
#
# yomi-prod (RDS) has no public IP and its security group only allows
# connections from yomi-backend-sg — there is no way to reach it directly
# from a laptop. This forwards a local port to the RDS endpoint through the
# EC2 box, which already has network access to it. Point a SQL client (psql,
# DBeaver, TablePlus, pgAdmin...) at 127.0.0.1:$LOCAL_PORT once this is running.
#
# The DB password is never touched by this script — fetch it separately with:
#   aws secretsmanager get-secret-value --secret-id <SecretArn> --query SecretString --output text
# (SecretArn: aws rds describe-db-instances --db-instance-identifier yomi-prod \
#             --query "DBInstances[0].MasterUserSecret.SecretArn" --output text)
#
# Usage: KEY=path/to/yomi-key.pem scripts/rds-tunnel.sh
set -euo pipefail

KEY="${KEY:?set KEY=path to the .pem SSH key (see AGENTS.md / project memory for the correct one)}"
HOST="${HOST:-ubuntu@34.227.91.40}"
RDS_ENDPOINT="${RDS_ENDPOINT:-yomi-prod.c2tu486e2z6d.us-east-1.rds.amazonaws.com}"
RDS_PORT="${RDS_PORT:-5432}"
LOCAL_PORT="${LOCAL_PORT:-15432}"

echo "==> tunneling 127.0.0.1:${LOCAL_PORT} -> ${RDS_ENDPOINT}:${RDS_PORT} via ${HOST}"
echo "==> DB name: yomi | user: yomi_app | leave this running while you use your SQL client"
exec ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -N -L "${LOCAL_PORT}:${RDS_ENDPOINT}:${RDS_PORT}" "$HOST"
