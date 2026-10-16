🇬🇧 English · [🇫🇷 Français](../fr/events.md)

# Events module

The board's **internal** calendar: this is where the BDE's events are planned and organized. The 42 intra remains
the public tool where students sign up, so this module has no registrations, no waiting list and no attendance
check.

![The events calendar](../images/en/calendar.webp)

## Turning the module on

The module is on by default at installation. To turn it on or off afterwards: **Settings**, **Modules** section. To
set its categories and the reminder hour: **Events** section ([details](configuration.md#events)).

While the module is off, it does not exist: no page, no link in the menu, no block on the dashboard, no reminder.

## Who can do what

Rights come from the member's **role** (see [Roles and rights](roles.md)). Three rights concern this module.

| Action                                               | View | Manage | Manage the shared calendar | Owner |
| ---------------------------------------------------- | :--: | :----: | :------------------------: | :---: |
| See **confirmed** events                             | yes  |  yes   |            yes             |  yes  |
| See **drafts**                                       |  no  |  yes   |             no             |  yes  |
| Create, edit, delete, confirm, cancel a date         |  no  |  yes   |             no             |  yes  |
| Add an event to your calendar, subscribe to the feed | yes  |  yes   |            yes             |  yes  |
| Manage the **BDE** calendar link                     |  no  |   no   |            yes             |  yes  |

"Manage" includes "View". The owner always has access to everything. Every creation, edit or assignment of a role is
written to the audit log.

These rules are checked **on the server**, on every page and every action: hiding a button is never the only
protection. A draft you have no right to is not "forbidden": it is not found.

## Creating an event

**Events** → **New event**, or, faster, **from the calendar**:

- **On a computer**, a **+** appears in the corner of a day when you point at it (and when the keyboard reaches it: Tab,
  right after the day itself; on a touch screen it is always there). It opens the form **on that day**.
- **On a phone**, tap a day, then **Add on this day** under the calendar.

The form then starts from **6 pm to 8 pm** on that day (BDE time zone), which you adjust like any other date. Without
a day (the **New event** button), it starts from tomorrow, 6 pm to 8 pm. A day in the past is accepted, to record an
event after the fact. **Cancel** brings you back to that day of the calendar. These shortcuts only exist for those who
can manage events: the others do not see them, and the form refuses them if they type its address.

![An event that repeats every week](../images/en/event.webp)

- **Title, start, end, location, description**: times are entered and shown in the BDE's time zone, whatever your
  browser's.
- **Category**: one of those the BDE defined in Settings.
- **Members in charge**: one or more members, **optional**. They are the ones who receive the day-before reminder by
  email. With nobody in charge, the reminder goes to the **owners and the members whose role allows managing
  events**: it is never sent to nobody.
- **Status**: a **draft** is only visible to those who can manage events. **Confirming** the event makes it visible to
  every member and triggers the confirmation notification.

### Required fields

Six fields are required, marked with a `*`: **title, start, end, location, description and category**. For a series,
the **end date of the series** is required too. Only the members in charge are optional. A text made only of spaces
counts as empty.

The check is done twice, with the same rules: in the form (the message appears under the field concerned), then on
the server, before anything is saved.

Events created **before** this rule, with an empty location or description, are shown normally. They are only
blocked at their **next edit** in the form, which will ask you to fill in those fields. Confirming, going back to
draft and canceling a date remain possible.

The **school year** (for example `2025-2026`) is computed by itself: from September to August, from the start date.
A series belongs to the school year of its first date.

## Events that repeat

Choose _Every week_, _Every 2 weeks_ or _Every month_, then a required **end date** (that day is included). A series
has 200 dates at most (a series that was cut in two, see below, counts each part on its own).

- Local time is kept through daylight saving changes: a "every Tuesday at 6 pm" session stays at 6 pm all year.
- For a monthly series, it is the same day of the month. In a shorter month, it is the last day: an event on the
  31st falls on April 30, February 28… A series cut on one of those days keeps its day: the following dates are
  back on the 31st.

### One date, or this date and the following

On the page of a series, pick a date in the list of dates (the one shown is in bold). Then **every action asks which
dates it is for**, in a window, with two choices:

- **Only this one**: this date changes, the others do not. It is the choice already selected.
- **This one and the following**: this date and all those after it. **On the first date, that is the whole
  series.** The window says how many dates that is.

It is the same window for **editing** (time, place, description, category, members in charge…), **confirming**,
**putting back to draft** and **deleting**. An event that does not repeat has no such question.

![The window that asks which dates an edit is for: only this one, or this one and the following](../images/en/series-dialog.webp)

| Action            | Only this one                                                                                                                                                                                  | This one and the following                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edit**          | The date gets **its own values**: only what you changed, the rest keeps following the series. You can move it to another hour or day. The frequency and the end date stay those of the series. | The series is **cut in two** at this date: the dates before it stay as they were, this date and the following get your changes, and you can change the frequency and the end date too. |
| **Confirm**       | This date is confirmed on its own and announced to the members, once.                                                                                                                          | This date and the following are confirmed, **including those that had been put back to draft** (the window says how many), and announced in **a single message**.                      |
| **Back to draft** | This date disappears for the members and from the BDE calendar link. The others stay.                                                                                                          | This date and the following go back to draft.                                                                                                                                          |
| **Delete**        | The date is **canceled**: it stays in the list, crossed out, and you can **restore** it.                                                                                                       | The series **stops at the date before**. This is final: the following dates, with what had been edited on them, are deleted. On the first date, the whole event is deleted.            |

In the list, a date that has its own values shows **Edited**, a date that is a draft shows **Draft**, a canceled date
is crossed out.

### What happens to the dates edited on their own

You edit "this one and the following" while some of the following dates had been edited on their own. The rule is the
one of Google Calendar: **what you change replaces what those dates had for that field, what you do not touch stays.**

- You change the place: every following date takes the new place, even those that had their own. A date that also
  had its own title keeps its title.
- You confirm the following: the dates that were draft are confirmed too.
- You change only the **hour**: the dates edited on their own, canceled dates and reminders already sent follow
  the new hour, day by day.
- You change the **day** or the **frequency** (every Tuesday instead of every Monday, every 2 weeks instead of every
  week): the dates are no longer the same, so what had been edited on them, and the canceled dates, cannot follow and
  are dropped.

The window shows how many dates will be brought in line.

### A series cut in two

"This one and the following" on a date that is not the first **cuts the series in two parts**. The first part stops
at the date before; the second starts at this date, with its own page. For the members and for the calendars it is
still **one series**: every date keeps its identifier, so a calendar that already has the dates updates them,
without duplicates.

The second part keeps the author, the members in charge and the fact that the series was announced (it is not
announced a second time because it was cut). Its school year is the one of its first date.

## Deleting an event

The **Delete** button on a page that is not a series deletes the event, for good. For a series, it asks which dates
(see above): deleting "this one and the following" from the first date deletes the whole series.

## Views

- **Monthly calendar**: the default view on a computer. Each event is colored by its category, drafts are dashed.
  Click a day to select it, an event to open it.
- **List**: the default view on a phone. Upcoming events, in order.
- **On a phone**, if you choose the **Calendar** view, the grid shows a colored dot per day, and the chosen day is
  detailed below.
- **Filters**: category, member in charge, school year. They are in the page's address, so they can be shared.
- **Detail page**: all the information of the date shown, the dates of a series and the actions.

## Adding it to your calendar

- **One event**: the **Add to my calendar** button on its page downloads an `.ics` file, which every calendar can
  read. For a series: the displayed date, or the whole series. A date edited or moved shows up as the
  same entry, updated; a canceled date, or one put back to draft for the BDE link, disappears.
- **Automatic sync**: the menu of your name → **My profile** → **Sync with my calendar**. Copy the personal link and
  add it to Google Calendar, Outlook or Apple Calendar (see [step by step](#adding-a-link-to-your-calendar-step-by-step)).
  Changes then show up by themselves, at the refresh rhythm of your calendar app.
- **One link for the whole BDE**: see [below](#the-bde-link-shared-calendar).

The link contains a **secret token specific to each member**:

- it only exposes what you are allowed to see (never a draft without the right), checked at every request: a right
  taken away applies at once;
- it stops working **immediately** if you are removed from the BDE;
- you can **regenerate** it from your profile (the old link stops working);
- do not share it: anyone who has it can read your calendar.

## The BDE link (shared calendar)

Personal links ask each member to subscribe themselves. To simplify, a member who has the **Manage the shared
calendar** right (or an owner) can create **a single link for the whole BDE**, to paste **once** into the board's
shared calendar. It then updates by itself. Personal links do not change.

- **Where**: **Events** → **Shared calendar** button. It is only visible to those who have the "Manage the shared
  calendar" right and to owners, even without the "Manage events" right.
- **What it contains**: only **confirmed** and **non-cancelled** dates. Never a draft: a date put back to draft
  disappears from it.
- **What you can do**: show the link, copy it, **regenerate** it (the old link stops working at once), **turn it
  off**. Each action is written to the audit log. The link itself is never in it, nor in the server's logs.
- **If the link is regenerated or turned off**, the subscribed calendar stops updating: paste the new link and delete
  the old subscription.

### When a member leaves the BDE

The link is a shared secret: anyone who copied it can read the calendar. When you remove a member while a BDE link is
active, the **Members** page immediately offers to **generate a new link**, with a sentence that explains why. It is
**not automatic**: regenerating forces you to paste the link again into the shared calendar, and it is up to you to
pick the right moment.

> **A limit to know.** The link _feeds_ a calendar; it does not decide **who can see that calendar**. If you paste it
> into a shared calendar (a BDE Google Calendar, for example), former members' access to **that calendar** is managed
> **in Google** (or Outlook, Apple), not in the platform: remove them from the sharing. Regenerating the link only
> stops the old link from working. What was already copied into the subscribed calendar is not erased by the
> platform.

## Adding a link to your calendar, step by step

This is valid for **the BDE link** as well as for **your personal link**. Copy the link first: it ends with `.ics`.

> **Be patient.** A subscribed calendar is not instant. **Google can take several hours** to refresh it, sometimes up
> to a day, and so can Outlook. This is normal: an event created or edited does not show up right away.

### Google Calendar

Do it **on a computer**: the mobile app does not offer this option.

1. Open Google Calendar on a computer, with the Google account concerned.
2. On the left, next to "Other calendars", click the **+**.
3. Click **From URL**.
4. Paste the link.
5. Click **Add calendar**.

The calendar appears under "Other calendars", visible in the account that added it. For a shared board calendar, use a
shared BDE Google account, or have each person add the link.

### Outlook

On Outlook.com or the new Outlook:

1. Open **Calendar**.
2. Click **Add calendar**.
3. Choose **Subscribe from web**.
4. Paste the link, give it a name (for example "BDE"), then click **Import**.

On classic Outlook for Windows: **File** → **Account Settings** → **Account Settings…** → **Internet Calendars** tab →
**New…**, then paste the link.

### Apple Calendar

On a Mac:

1. Open **Calendar**.
2. **File** menu → **New Calendar Subscription…**
3. Paste the link, then click **Subscribe**.
4. Choose the update frequency, then **OK**.

On an iPhone or iPad: **Settings** → **Calendar** → **Accounts** → **Add Account** → **Other** → **Add Subscribed
Calendar**, then paste the link.

## Notifications

The channel (email, Discord, Slack or none) and its settings are chosen in **Settings**, **Notifications** section,
with a test message. For messages to contain a link to the event, set the address of the platform (**Address of the
platform** section): without it, messages go out without a link.

| Notification                        | When                                                                                                                           | Who receives it                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Confirmation** (`eventConfirmed`) | an event goes from draft to **confirmed**, once; for a series, once for the confirmed part, or once for a date confirmed alone | every approved member (email: one message per person), or the Discord or Slack channel |
| **Reminder** (`eventReminder`)      | the day before each confirmed occurrence, at the **reminder hour** (6 pm by default, BDE time)                                 | the **members in charge** (email), otherwise those who manage events; or the channel   |

The rendering on Discord, Slack and by email is described in [Notifications](notifications.md).

Sending happens **after** the response: a failed send never prevents saving an event. By email, a failure for one
recipient does not prevent sending to the others. It is written in the server's logs (`[events] …`).

### How the day-before reminder works

There is nothing to install: no cron, no scheduled task, no external service. At start, the server launches a small
internal loop that checks **every 5 minutes** whether a reminder is due. It works the same on Windows, Linux, macOS
and Docker.

A reminder is **due** from the reminder hour, the day before the occurrence, and stays sendable as long as the event
has not started. The message says "tomorrow". When it goes out on the same day (catching up after an outage), it says
"today".

**It is never sent twice**, even after a restart or with two instances: before sending, the server records in the
database that this reminder is "claimed" for this precise occurrence. Only the one whose record succeeds sends.
Consequences:

- if the server was off at the reminder hour, the reminder goes out as soon as it restarts, as long as the event has
  not started;
- if the server crashes _exactly_ between the record and the send, that reminder is lost rather than doubled: a rare
  miss is preferred to a duplicate;
- no reminder for a draft, for a cancelled date, nor for an event confirmed _after_ the reminder hour (the members
  were just notified);
- if the server stays off all day until after the event starts, the reminder is lost: the platform must run
  continuously.

Events that repeat are reminded date by date, **once per date**, whatever happens to the series: a date moved
after its reminder was sent is not reminded again, and a series cut in two keeps the reminders already sent. The
reminder shows the time, place and members in charge of that date.

## Audit log

Owners see there the creation, the edit (with the list of fields changed), the deletion, the status change, the
cancelation and restoration of a date, and the actions on the BDE link (never the link itself). For a series, every
entry says whether the action was for **one date** or for **this date and the following**, and which date (for
the first date: that it was the whole series). The author is the
real account, written as text: it stays readable even if the member is removed afterwards.

## A problem?

A reminder did not go out, a calendar does not update, the BDE link answers "Not found": see
[Troubleshooting](troubleshooting.md#events-and-calendars).
