# Discord Forms Local

Local forms website, moderation panel, and live deploy control.

## Start

```bash
cd /home/hoodlandon25/discord_forms_local
cp .env.example .env
# edit .env and set your own admin login, reset code, webhook values, and deploy values
./start_discord_forms.sh
```

## Stop

```bash
cd /home/hoodlandon25/discord_forms_local
./stop_discord_forms.sh
```

## Features

- build and edit the website locally from this folder
- add short answer, paragraph, multiple choice, and checkbox questions
- open a fillable form page
- review submitted responses
- track visitors, activity, bans, and deploy runs in the control panel
- ban by device IP or network IP with a visible ban reason
- update the live website with `./deploy_website.sh`
- auto-sync local edits with `./watch_and_deploy.sh`

## Commands

```bash
/home/hoodlandon25/forms_site.sh path
/home/hoodlandon25/forms_site.sh start
/home/hoodlandon25/forms_site.sh stop
/home/hoodlandon25/forms_site.sh deploy
/home/hoodlandon25/forms_site.sh watch
```

## Deploy Setup

- `DEPLOY_METHOD=local-copy` with `DEPLOY_LOCAL_DIR=/path/to/live/site` copies this folder to another local directory.
- `DEPLOY_METHOD=rsync` with `DEPLOY_HOST` and `DEPLOY_PATH` syncs this folder to a remote server over SSH.
- `deploy_website.sh` excludes local secrets and runtime files like `.env`, auth data, PID files, and logs, while still publishing your saved forms.

## Real Website Setup

1. Run the app locally from this project and keep editing here.
2. Create a separate live server folder or remote host that will run the same project files.
3. Put your real secrets only on the live server in its own `.env`:
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `RESET_CODE`, `ACCOUNT_CREATE_CODE`, `RESET_WEBHOOK_URL`, `SUBMISSION_WEBHOOK_URL`, `DECISION_WEBHOOK_URL`, `DISCORD_CLIENT_SECRET`.
4. For production hosts with persistent storage, set `DATA_DIR` to that mounted disk path so forms, admin accounts, and moderation data survive redeploys.
5. Configure this local project for one-click publishing:
   - Local target: set `DEPLOY_LOCAL_DIR=/path/to/live/server/folder`
   - Remote target: set `DEPLOY_METHOD=rsync`, `DEPLOY_HOST`, `DEPLOY_PATH`, and optionally `DEPLOY_USER` / `DEPLOY_SSH_PORT`
6. Start the live server separately on the production machine using the same app files and its own `.env`.
7. Use the in-app `Update Live Website` button or `/home/hoodlandon25/forms_site.sh deploy` to push code changes from local to live.

The browser never receives the secret values. The admin UI now only shows safe deploy status such as configured method, target summary, and whether each secret-backed feature is ready.

## Access

- While the server is running on this machine, anyone who can reach this machine's network address can open the public homepage and use the listed forms.
- When the process stops, the site stops.
- Admin credentials, reset codes, and webhook URLs now come from the local `.env`, not the source code.
