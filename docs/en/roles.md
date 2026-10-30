🇬🇧 English · [🇫🇷 Français](../fr/roles.md)

# Roles and rights

Each BDE creates the roles it needs (President, Treasurer, Secretary, Events lead…) and chooses precisely what each
one may do. Each member has **one role**, which you change in a menu of the **Members** page.

![The Roles page](../images/en/roles.webp)

## The three situations of an account

| Situation   | What it means                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**   | Has **every right**, including the audit log and Settings. Set only in **Settings**, Owners section, by another owner. Never changed from the Members or Roles pages. |
| **Member**  | An approved account. Its rights are exactly those of its role.                                                                                                        |
| **Pending** | Has just signed in and waits to be approved. Can only see the waiting page.                                                                                           |

"Owner" and "Pending" are not roles: they can be neither edited nor given. **The audit log and Settings are for
owners only**, whatever the roles: a right a role could have would let its holder name themselves owner.

## The two roles created at installation

| Role       | Rights                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| **Admin**  | "All rights" (see below).                                                |
| **Membre** | View events. It is the **default role**: the one offered to new members. |

They carry these names, in French, in every language. You can edit and rename them like any other role.

## The Roles page

It is available to those who have the **Manage roles** right. For each role, it shows its name, a description, the
number of members who have it and its rights.

- **Create a role**: a name (40 characters at most, unique), an optional description (200 characters at most) and
  rights, each explained in one sentence.
- **Edit**: the name, the description, the rights. Changes apply at once to every member who has the role, and are
  written to the audit log with what changed.
- **Delete**: only if **no member** has the role any more. First give its members another role, from the Members
  page. The default role cannot be deleted: make another one the default first.
- **Default role**: the one preselected when you approve a request. The **Make default** button is on the row of
  another role.

### "All rights"

The **All rights** box gives the role absolutely every right, **including those of modules added later**. The Admin
role is like this. To keep a module for some roles only, untick the option and choose the rights one by one: a new
module then only shows up in that role if you tick it.

## The rights

| Right                       | What it allows                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manage members**          | Approve or reject access requests, remove members and give them a role.                                                                                                                                           |
| **Manage roles**            | Create, edit and delete roles, and choose the rights of each.                                                                                                                                                     |
| **Customise notifications** | Change what the Discord cards, Slack messages and e-mails say and how they look (the **Notifications** page), and choose whom they mention. The channels themselves (webhooks, mail server) stay with the owners. |

And, **for each module that is on**:

| Right                 | What it allows                                          |
| --------------------- | ------------------------------------------------------- |
| **View** the module   | See its content.                                        |
| **Manage** the module | Create, edit and delete in the module. Includes "view". |

The **Events** module has rights of its own, instead of "Manage":

| Right                                    | What it allows                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Propose events**                       | Create events that wait for a validator, and edit or delete your own as long as they are not published. Includes "view".            |
| **Validate events**                      | Validate or refuse proposals, create, edit, confirm and delete any event, and see drafts. Includes "propose" and "view".            |
| **Manage the shared calendar**           | Create, renew or turn off the BDE's common calendar link. Includes "view".                                                          |
| **Publish on the intra**                 | For the school's staff: see the requests to publish events on the intra, copy their fields and answer. Includes nothing: see below. |
| **Follow the publications on the intra** | See where the publication of each event stands, without answering. Includes "view".                                                 |
| **Ask for a publication on the intra**   | Send a refused request again, or one for an event already confirmed. Validating events already allows it. Includes "view".          |

A team that organizes events without being allowed to publish them gets **Propose events**; the board, which decides,
gets **Validate events**. See [Events module](events.md#proposing-and-validating-events).

**Publish on the intra** is the right of the school's staff, who publish the BDE's events on the intra 42. It includes **nothing**,
on purpose: a role that holds only this right sees the page of the requests and neither the calendar, nor the members, nor the
settings. Add "View events" to the role if the staff also wants the calendar. These three rights do something only once an owner turns on
**Publish events on the 42 intra** (Settings, Events).

Ticking "manage", "validate" or "propose" ticks what it includes. A right of a module that is **off** stays in the role with no effect, and takes
effect again if you turn the module back on.

## The security rules

The server applies them at every action, whatever the interface. The idea is simple: **you can only give, edit or
take away what you hold.**

1. **You can only grant what you hold.** To create, edit or give a role, you must hold every right it grants
   yourself. An "All rights" role can only be created, edited or given by someone who holds all rights themselves
   (or by an owner).
2. **Nobody edits their own role** (renaming it, taking a right away, deleting it, making it the default): someone
   else, or an owner, has to.
3. **Nobody changes their own role, or removes themselves from the BDE.**
4. **You do not touch a role that gives more rights than yours**: you cannot take rights away from it (to weaken a
   superior), delete it or make it the default.
5. **You do not move a member whose role goes beyond yours.** A secretary can neither demote the president nor
   remove her from the BDE. They can, however, move or remove a colleague who has exactly the same rights as
   them: everything is in the audit log.
6. **An owner can be neither edited nor removed** from the Members and Roles pages. Only an owner can add or remove
   one, in Settings (with a confirmation, the audit log, never themselves, and always keeping at least one owner).
7. **A role that is still given cannot be deleted.**
8. Rights are **read again from the database at every action**: taking a right away from a role applies at once, even
   to someone whose page was already open.

Every creation, edit, deletion or assignment of a role is **logged** in the audit log, for owners only.

> If nobody has the right to manage roles any more, an owner always can: there is at least one.

## Example organization

| Role        | Rights                                           |
| ----------- | ------------------------------------------------ |
| President   | Manage members, manage roles, every Events right |
| Secretary   | Manage members, validate events                  |
| Events lead | Validate events and manage the shared calendar   |
| Events team | Propose events                                   |
| Membre      | View events                                      |

With these rules, the secretary can approve a request and give it "Membre", but not "Events lead": they do not have
the right to manage the shared calendar, and you can only give what you have. In the same way, the events lead can give
"Events team", which they hold, but a member of the events team can never give the right to validate.

## Testing what a role can do

In development (`ENABLE_DEV_IMPERSONATION=true`, see the [contributor guide](contributing.md)), the owner can
**simulate any role** from a banner at the top of the page, and check what that role sees and can do. The
simulation respects the chosen role's limits, and actions stay recorded under the real owner's name, with the
simulated role. This feature does not exist in production.

## For developers

The list of rights lives in the code, not in the database: a role keeps plain keys (`events.validate`). To add the
rights of a module, see the [architecture](../architecture.md).
