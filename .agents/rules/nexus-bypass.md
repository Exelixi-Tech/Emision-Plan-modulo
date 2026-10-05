# Nexus Tokens Bypass Rule

When the user says **"bypass nexus tokens"** or asks to test without Nexus SSO authentication tokens:

1. **Test Route Routing & Bypass (`frontend/src/main.tsx`)**:
   - Ensure routes like `?view=personas`, `?test=personas`, `/personas`, or `/test/personas` are routed directly to test components (e.g. `PersonasPlansTestForm`) without being wrapped in `<NexusGuard>` or triggering session token checks.
   - For general testing, allow bypassing `<NexusGuard>` when test parameters (`?bypass=1`, `?test=1`, `?view=personas`, etc.) are present in the URL.

2. **Personas API v2 Endpoint & Headers (`frontend/src/lib/api.ts`)**:
   - Endpoint: `https://nexusqa.exelixitech.com/nest-api-docs/api/v1/personas/planes` (Method: `POST`)
   - Default Headers:
     ```json
     {
       "Content-Type": "application/json",
       "apikey": "2b7dd2e40dad443a2e9ab4c9951f4489341184e7b6d1b3eb1241f39fb7572f2c",
       "x-api-key": "2b7dd2e40dad443a2e9ab4c9951f4489341184e7b6d1b3eb1241f39fb7572f2c"
     }
     ```
   - Default Base Payload (overriding only `citem`, `centidad`, `cproducto`, and `cramo` from the view):
     ```json
     {
       "cramo": 7,
       "ctipo": null,
       "citem": "215",
       "centidad": "P",
       "cproducto": "14",
       "cproductor": "215",
       "cusuario": "7",
       "cgestor_in": "marismendi@lamundialdeseguros.com",
       "cgestor": "80080-27-0"
     }
     ```

3. **Port and URLs**:
   - Dev port: `5183` (defined in `frontend/vite.config.ts`).
   - Quick test URL: `http://localhost:5183/?view=personas`
