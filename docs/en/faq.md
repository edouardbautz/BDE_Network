🇬🇧 English · [🇫🇷 Français](../fr/faq.md)

# Frequently asked questions

- [Getting started](#getting-started)
- [Members and roles](#members-and-roles)
- [Events and calendars](#events-and-calendars)
- [Notifications](#notifications)
- [Data and security](#data-and-security)
- [Running it](#running-it)

## Getting started

### What is BDE_Network for?

It is a platform to run a BDE at a 42 school: members sign in with their 42 account, the board gives them roles, and
the events calendar is shared and can be synced with Google Calendar, Outlook or Apple Calendar. See the
[user guide](user-guide.md).

### Do I need to know how to code to install it?

No. You install Docker, run one command, then follow a page in the browser. See [Installation](installation.md). No
file to edit.

### Is it free?

Yes. The project is free software (MIT license) and each BDE hosts it itself: there is no subscription and no service
to pay for. Only the server, if any, and the domain name cost money.

### Do I need a server and a domain name?

- **To try it**, no: your computer is enough (`http://localhost:3000`).
- **For members to use it**, yes: a server that stays on, a domain name and an HTTPS proxy. See
  [Deployment](deployment.md).

### Can people sign in with something other than 42?

No. Signing in works with 42 accounts only, so that no password has to be managed.

### Can several BDEs share one platform?

No. Each BDE has **its own platform**: its own database, its own settings, its own 42 application. Nothing is shared
between two BDEs.

### Where are the other modules (finances, meetings)?

They are planned but do not exist yet. Only the **Events** module is available.

## Members and roles

### Who can sign in?

People who have a 42 account in one of the **allowed campuses** (every campus if the list is empty). The first time,
their account is **pending**: a board member approves it and picks its role.

### How does someone become an owner?

An owner adds the person's 42 login in **Settings**, Owners section. A role, even "All rights", never makes someone an
owner. See [Roles and rights](roles.md).

### What is the difference between an owner and Admin?

An **owner** has every right, including the audit log and Settings, and depends on no role. **Admin** is a role like
any other, with "All rights": it sees neither Settings nor the audit log.

### Can a member have several roles?

No, just one. To combine rights, create a role that gathers them.

### Why can't I give this role to someone?

You can only give what you hold: to give a role, you must have every right it grants. This is intended, so that nobody
can give themselves more rights. See [the security rules](roles.md#the-security-rules).

### What happens when I remove a member?

Their account is **deleted** (not just disabled). They can ask for access again by signing in. Their personal calendar
link stops working at once. If a BDE calendar link is active, the platform offers to generate a new one.

### How do I change the BDE's name, color or logo?

In **Settings**: the **Your BDE** section for the name and color, the **Logo** section for the logo. It is immediate.

### How do I change the language?

Each person picks the interface language with the language icon at the bottom of the sidebar. The language of the
**messages sent** (email, Discord, Slack) is the same for the whole BDE: **Your BDE** section of Settings.

## Events and calendars

### Are events public?

No. The module is the board's **internal** calendar. Students' registrations stay on the 42 intra.

### What is the difference between a draft and a confirmed event?

A **draft** is only visible to those who can manage events. A **confirmed** event is visible to every member, and
confirming it notifies them. See [Events module](events.md).

### Why does Google Calendar take hours to show an event?

A calendar you subscribe to by link is not instant: Google only refreshes it every few hours, sometimes up to a day.
This is not a flaw of the platform.

### What if the calendar link leaked?

Regenerate it: the old link stops working at once. Each member does it from **My profile**; the BDE link is
regenerated from **Events** → **Shared calendar**.

### How do I cancel a single session of a series?

On the event's page, pick the date in the list, then **Delete** and **Only this one**. The date is canceled, the rest
of the series is untouched, and the date can be restored (**Restore** button).

### How do I change one session of a series only, or all the following ones?

Pick the date, **Edit**, change what you need, then **Save**: a window asks **Only this one** or **This one and the
following**. See [Events that repeat](events.md#events-that-repeat).

## Notifications

### Do I need Discord or Slack?

No. Without a channel, the platform sends nothing. **Discord** is the easiest to set up: a webhook takes two clicks.
See [Notifications](notifications.md).

### Can I choose a different channel for each notification?

Not in the Settings page: it applies a single channel to every notification. One channel per type is possible with the
configuration files (see [Configuration](configuration.md#replace-the-settings-with-files)).

### Why does the removed person not get an email?

This is intended: a removal **never** sends an email to the removed person. Only the Discord or Slack channel is
notified.

## Data and security

### Where is my data?

On **your** server, in your database. It only leaves the platform for three reasons: signing in with 42, sending the
notifications you chose (Discord, Slack, mail server), and the logo that Discord fetches itself.

### What data is collected?

For each member: their login, name, email, campus and 42 photo, resynchronized at every sign-in. The platform's
**Privacy** page details it, and each member can **download a copy** of their data there. See the
[user guide](user-guide.md#your-personal-data).

### How do I delete a person's data?

**Remove from BDE** deletes their account for good. The audit log only keeps their login, as text, with no link to an
account.

### Who sees the audit log?

Owners only, read-only. It can be neither edited nor deleted from the interface.

### How do I report a security flaw?

**Not** in a public issue. Use GitHub's private report: see [SECURITY.md](../../SECURITY.md).

## Running it

### How do I back up?

`./scripts/backup.sh` creates two files: the database and the keys (the `secrets` volume). **Both matter.** See
[Backups](deployment.md#backups-and-restore).

### How do I upgrade?

Back up, get the new code, then `docker compose up --build -d`. See [Upgrading](upgrading.md).

### What if the 42 application's key expires?

An owner creates a new one on the intra and pastes it in **Settings**, 42 application section. If nobody can sign in
any more, there is a rescue: see [Troubleshooting](troubleshooting.md#when-signing-in).

### Why `localhost` and not `127.0.0.1` or `0.0.0.0`?

For 42, an address is an exact string. The platform always writes `localhost` for your computer, and refuses `0.0.0.0`,
which is the address the server listens on and not a site address. Open the platform at the registered address.

### Can it run without Docker?

The documented deployment uses Docker, and it is the only one that is tested. To develop, see the
[contributor guide](contributing.md).

### Where do I find help?

In [Troubleshooting](troubleshooting.md), then in the [issues](https://github.com/edouardbautz/BDE_Network/issues). The
words of the project are in the [glossary](glossary.md).
