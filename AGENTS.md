# ShoppingApp browser tests

- Use the Playwright `iphone-webkit` project for browser acceptance. Add Chromium coverage only after Илья explicitly requests it.
- Keep one browser scenario for each distinct user-visible behavior in each relevant mode. Keep separate checks when they verify a different contract, such as local persistence, hosted Supabase sync or isolated PostgreSQL recovery.
- Keep guest PWA, mocked email flows and hosted Supabase scenarios on their respective build configurations.
