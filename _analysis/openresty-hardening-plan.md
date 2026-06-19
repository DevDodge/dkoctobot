# خطة تضخيم OpenResty - Gateway

## الهيكل الحالي

```
n8n → Flowise (port 1252, CMD) → Gateway OpenResty (8080) → Next.js (15595) → AI Providers
```

## المشكلة الجذرية

- OpenResty عنده upstream واحد فقط (Next.js:15595)
- `max_fails=3 fail_timeout=30s` — 3 أخطاء في 30 ثانية = 30 ثانية Blackout كامل
- `max_conns` غير محدد — Next.js ممكن يغرق
- Zero retry logic — أي خطأ مؤقت يتحول لـ 502
- No rate limiting — أي flood يوقع الباك إند

## التعديلات المطلوبة (4 ملفات)

### 1. `nginx.conf` — العمالقة

- `worker_connections`: 4096 → 16384
- إضافة `worker_shutdown_timeout 30s`
- إضافة `reset_timedout_connection on`
- إضافة `proxy_next_upstream` defaults لحماية مستوى الـ http
- زيادة `keepalive_timeout` من 65 → 120
- إضافة `keepalive_requests` حد أعلى
- رفع `types_hash_max_size` و `server_names_hash_bucket_size`

### 2. `upstream.conf` — توزيع الأحمال

- `max_conns=150` على الـ server الوحيد (يمنع إغراق Next.js)
- `fail_timeout` من 30s → 10s (تعافي أسرع)
- `max_fails` من 3 → 5 (أكثر تسامح)
- `keepalive` من 32 → 64
- `keepalive_timeout` من 60s → 120s
- `keepalive_requests` من 1000 → 5000

### 3. `gateway.conf` — الحماية والـ retry

- Streaming endpoints:
  - `proxy_read_timeout`: 300s → 600s
  - `proxy_send_timeout`: 300s → 600s
  - إضافة `proxy_next_upstream error timeout http_502 http_503 http_504`
  - إضافة `proxy_next_upstream_tries 2`
  - إضافة `proxy_next_upstream_timeout 30s`
  - إضافة `proxy_connect_timeout`: 10s → 5s (فشل أسرع = تعافي أسرع)
- General endpoints:
  - `proxy_read_timeout`: 60s → 120s
  - إضافة نفس retry logic
- إضافة rate limiting zone للـ API endpoints
- إضافة `/openresty-status` endpoint للـ monitoring

### 4. ملف جديد `conf.d/ratelimit.conf` — منع الإغراق

- `limit_req_zone` للـ API endpoints (10 requests/second)
- `limit_conn_zone` لكل IP (20 connections)
- تطبيق الـ zones في location blocks المناسبة

## ملفات هتتعدل

1. `/f/gateway/docker/openresty/nginx.conf`
2. `/f/gateway/docker/openresty/conf.d/upstream.conf`
3. `/f/gateway/docker/openresty/conf.d/gateway.conf`
4. `/f/gateway/docker/openresty/conf.d/ratelimit.conf` (جديد)
