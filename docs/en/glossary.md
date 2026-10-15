🇬🇧 English · [🇫🇷 Français](../fr/glossary.md)

# Glossary

The words of the platform, as they appear in the interface. One word always means one thing in this documentation.

## People

| Word             | Meaning                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **BDE**          | _Bureau Des Étudiants_: the student association of a school. "The board" means the members who run it.                                |
| **Platform**     | The site a BDE runs with BDE_Network. A platform belongs to one BDE alone (an _instance_).                                            |
| **Owner**        | An account with **every right**, including the audit log and Settings. The list of owners is managed in **Settings**, Owners section. |
| **Member**       | An approved account. Its rights are those of its **role**.                                                                            |
| **Pending**      | An account that has just signed in and that nobody has approved yet. It can only see the waiting page.                                |
| **Role**         | A named set of rights (President, Treasurer…). Each member has **one** role.                                                          |
| **Default role** | The role offered first when an access request is approved. There is always one.                                                       |
| **Right**        | What a role allows ("Manage members", "View events"…). The code calls it a _permission_.                                              |
| **All rights**   | An option of a role: it gets every right, including those of modules added later.                                                     |

## Signing in

| Word                        | Meaning                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **42 intra**                | The 42 students' website, where the BDE's OAuth application is created.                                                                                   |
| **42 application**          | The "application" the BDE registers on the intra so that its members can sign in with their 42 account. It gives a **UID** and a **secret** (the SECRET). |
| **Redirect URL**            | The address 42 sends the person back to after signing in: the platform's address followed by `/api/auth/callback/42-school`. It must be **exact**.        |
| **Allowed campuses**        | The 42 campuses whose members may sign in. An empty list means every campus.                                                                              |
| **Address of the platform** | The address your members type (`https://bde.example.org`). It is used for signing in with 42 and for the links in messages. Never `0.0.0.0`.              |

## Events

| Word                       | Meaning                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Module**                 | A function you turn on: for now, the **Events** module.                                                    |
| **Event**                  | An activity of the BDE, with a title, a start, an end, a location, a description and a category.           |
| **Draft**                  | An event only visible to those who can manage events.                                                      |
| **Confirmed**              | An event visible to every member. Confirming it notifies the members.                                      |
| **Series**                 | An event that repeats (every week, every two weeks, every month) until a date.                             |
| **Occurrence**             | One date of a series. You can cancel an occurrence without touching the rest.                              |
| **Category**               | A type of event, with a name and a color (Party, Sport…). Each BDE has its own.                            |
| **School year**            | From September to August (`2025-2026`), computed from the start date.                                      |
| **Personal calendar link** | A member's secret link, to add to Google Calendar, Outlook or Apple Calendar. See **My profile**.          |
| **BDE calendar link**      | One link for the whole BDE, to paste once into a shared calendar. It is managed under **Shared calendar**. |

## Messages

| Word             | Meaning                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| **Notification** | A message the platform sends: event confirmed, reminder, access request, member approved or removed. |
| **Channel**      | Where the notification goes: email, Discord, Slack, or none.                                         |
| **Webhook**      | The secret address of a Discord or Slack channel, which lets the platform write in it.               |
| **Card**         | The formatted message the platform posts on Discord or Slack.                                        |
| **Reminder**     | The notification sent the day before an event, at the **reminder hour** set in Settings.             |

## Running it

| Word                 | Meaning                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Installer**        | The page that guides the installation in the browser. It disappears for good once the platform is installed.                  |
| **Setup code**       | The 8-character code (`K7QM-4XPD`) shown in the terminal, which stops anyone else from installing the platform in your place. |
| **Settings**         | The page where owners change the settings, section by section.                                                                |
| **Audit log**        | The read-only list of sensitive actions (who did what, when). Owners only.                                                    |
| **"secrets" volume** | The Docker volume that holds the platform's keys. You must **back it up** along with the database.                            |
| **Backup**           | Two files created by `./scripts/backup.sh`: the database and the keys.                                                        |
| **HTTPS proxy**      | The program (Caddy, Nginx…) that receives visitors over HTTPS and passes them to the platform.                                |
| **Upgrade**          | Moving to a new version of the code: see [Upgrading](upgrading.md).                                                           |
