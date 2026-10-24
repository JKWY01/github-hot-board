#!/bin/sh
# GitHub 火线榜库健康滚动备份:每日 pg_dump,残留保留最近 7 份。
TS=$(date +%Y%m%d-%H%M%S)
docker exec 1Panel-postgresql-qPHU pg_dump -U ghb -d ghb -Fc -f "/tmp/ghb-$TS.dump" >/dev/null 2>&1 || exit 1
docker cp 1Panel-postgresql-qPHU:"/tmp/ghb-$TS.dump" /opt/ghb-backups/ >/dev/null
docker exec 1Panel-postgresql-qPHU rm -f "/tmp/ghb-$TS.dump"
ls -1t /opt/ghb-backups/*.dump 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null
echo "$(date '+%F %T') backup ok: ghb-$TS.dump($(du -h "/opt/ghb-backups/ghb-$TS.dump" | cut -f1))"
