# Self-hosted Supabase setup

1. Deploy the official [Supabase Docker stack](https://supabase.com/docs/guides/self-hosting/docker) on your server. Configure its external HTTPS URL, strong deployment secrets, persistent Postgres/Storage volumes and SMTP/email confirmation. Keep the database/admin endpoints private.
2. Apply the SQL in `supabase/migrations` in filename order as administrator, once: `202609110001_unidesk_sync.sql`, `202609110002_entity_schema.sql`, `202609110003_device_access.sql`. Use Studio SQL or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`. Do not apply the disposable-test bootstrap.
3. The migrations create owner-scoped devices, records, revisions, the validated sync RPC and the private `unidesk-files` bucket. Client direct writes to academic tables are denied; mutations go through version checks in the RPC. Storage permits only authenticated owner reads/inserts. Blobs remain immutable. The third migration enforces device/session revocation on both records and Storage.
4. Give each UniDesk installation your HTTPS API URL and public/anon key. Users create/sign into their own email/password accounts. Never put the service-role key in the app. Optional client build defaults are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Review and enable the first workspace upload, then sign in on the fresh tablet and choose Set up this device. Confirm counts and likely duplicates before combining independent existing datasets. Small documents download automatically; larger files can download on open.
6. Back up Postgres and Storage together. Retain revisions and tombstones; do not reset history while devices hold old cursors. UniDesk provides TLS plus ownership policies, not end-to-end encryption.

## Disposable local integration environment

Install the Supabase CLI and Docker, initialize a separate working directory, copy the migrations into its `supabase/migrations`, and run `supabase start --workdir <directory>`. Use a test server with email auto-confirm for automated signup. The repository's real integration test uses environment configuration and no production credentials. See [sync.md](sync.md) for exact commands and [android.md](android.md) for emulator forwarding and native tests.

The development browser continues to use the loopback SQLite adapter for shared UI work. Secure account setup/file sync uses installed native clients; the headless SyncEngine tests inject HTTP adapters to develop/test synchronization without launching Android.
