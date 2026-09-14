# Security and resilience matrix

| Boundary | Required checks |
| --- | --- |
| Tenant API | authentication, authorization, rate limits, audit |
| Workflow | replay, cancellation, duplicate steps, teardown |
| Evidence | SSRF, redaction, tamper, retention, cross-tenant access |
| Integrations | callback dedupe, webhook signatures, RPC outage |
