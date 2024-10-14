## BOM

npm start

## Redis

redis-server config/redis.conf

## Prometheus

prometheus --config.file=config/prometheus.yml

## Grafana

sudo grafana-server --homepath /usr/share/grafana --config /etc/grafana/grafana.ini

## Loki

loki --config.file=config/loki-config.yaml
