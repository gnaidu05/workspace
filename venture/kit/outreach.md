# Getting client #1

*The constraint this is written for: a war chest that cannot fund acquisition.
Every channel below is free. None of it is advertising.*

---

## Who the client is

Not "small businesses." That is not a target, it is a category.

**The client is someone who has publicly described a spreadsheet that has
outgrown itself.** They usually say one of these things:

- "My Google Sheet has 40 tabs and keeps breaking"
- "Three people edit this and we keep overwriting each other"
- "I need this to email someone when a value changes"
- "We track this in Excel and copy it into [other system] by hand"
- "The macro broke when we moved to Sheets"

That is the whole qualification. They have named the pain, so you do not have to
create it — the hardest part of selling is already done, by them, in public.

**Where they are, geographically, matters more than what they do.** Bill in USD
(section 1 of the plan: 4.4x). So: US, UK, Canada, Australia, Western Europe.
A great Indian lead is worth a quarter of an identical American one.

## Where to find them — all free

Ranked by intent, which is the only ranking that matters:

| Channel | Why it works |
| --- | --- |
| **r/excel, r/googlesheets** | Highest intent anywhere. People post broken spreadsheets *daily*, asking for help, with the problem already written out |
| **r/smallbusiness, r/msp, r/sysadmin** | Operational pain, budget authority, less formula-help and more "this process is killing us" |
| **Industry-specific forums** | Trades, clinics, agencies, nonprofits. Lower volume, far less competition, higher trust |
| **Indie Hackers / HN "Who wants to be hired"** | Peer credibility; occasional direct work |
| **Your existing network** | The single highest close rate you will ever have. Boring, unglamorous, works |

Notably absent: Upwork and Fiverr. They are not wrong, but you compete on price
against a global floor there, which is the one game the export arbitrage is
meant to let you avoid. Use them for a first review or two if you need proof,
then leave.

## The method

**Answer first. Sell second, or not at all.**

1. **Find a post describing the problem.** Filter for: a real business (not a
   student), a recurring process (not a one-off), and a country that pays USD.
2. **Actually solve what they asked.** Give them the formula, the script, the
   fix. Publicly, for free, with no pitch attached. If it takes twenty minutes,
   spend the twenty minutes.
3. **Then, once — and only if it genuinely applies:** note that the underlying
   problem is structural, and that you build small tools that replace this kind
   of sheet. Offer the Audit.

Step 2 is not a trick to earn step 3. If you treat it as one it reads as one.
The reason this works is that the public answer *is* the portfolio: anyone
reading the thread can see you solved a real problem competently, which is more
convincing than any claim you could make about yourself.

Expect roughly 1 in 20 good answers to turn into a conversation, and a minority
of conversations to turn into an Audit. That is a fine rate for something that
costs nothing but time.

## Templates

Short, specific, no adjectives. Every one of these should be edited until it
could only have been sent to that one person.

### After answering their question publicly

> That formula should sort it.
>
> For what it's worth, the reason it broke is structural — [specific reason,
> one sentence]. Sheets is doing something it wasn't built for, and it'll
> break again the next time the data shape changes.
>
> I build small web tools that replace exactly this kind of sheet. If it's
> worth a look I do a fixed-price **$250 audit**: I go through the process and
> write up what's brittle, what to automate, and what it'd cost. No obligation
> to build anything with me afterwards — a fair number of people take the
> write-up and do it themselves.
>
> Either way, good luck with it.

### Cold email — only to a business that has publicly described the problem

> Subject: your [specific process] spreadsheet
>
> Hi {{NAME}},
>
> I saw your post about [specific thing, quoted accurately]. [One sentence of
> genuinely useful diagnosis — prove you read it.]
>
> I build small, tested web tools that replace spreadsheets like that. Recent
> example: [case-study.md link] — a multi-stop travel planner, no dependencies,
> 45 tests, deployed three ways.
>
> If it's useful I do a fixed $250 audit of the process before anyone commits
> to a build. If not, no reply needed and I won't follow up.
>
> {{YOUR_NAME}}
> {{YOUR_EMAIL}}

**"I won't follow up" is a promise. Keep it.** One email per prospect. The
follow-up sequence is what turns outreach into spam, and it is not worth the
reputation of the one identity you have.

### When they ask "how much would the build be"

> Depends what the audit turns up, but the shape is usually:
>
> - **Build — $1,500.** One workflow replaced with a real tool. Roughly 20
>   hours, capped at 30 so the price can't run away from either of us. You get
>   the source.
> - **Care — $400/month.** Hosting, changes, support. Optional, cancel anytime.
>
> The audit is $250 and comes off the build price if you go ahead.

Rolling the Audit into the Build removes the buyer's main objection — paying
twice — at a cost of $250 on deals that were going to close anyway.

## The rules

1. **One email per prospect. No sequences.** Mention it, then honour it.
2. **Never contact someone who hasn't publicly described the problem.** Scraped
   lists are spam regardless of how the message is worded.
3. **Commercial email to the US must satisfy CAN-SPAM** — accurate headers, a
   real postal address, a working opt-out. The EU and UK are stricter under
   GDPR/PECR. Low-volume, individually-written, genuinely-relevant email is
   both the compliant path and the one that works. *Check the current rules for
   the country you're writing to; this is not legal advice.*
4. **Never claim a client you don't have.** Say "recent example" and link
   CampusRoute, which is honestly described as a rebuild. A single invented
   testimonial costs the whole identity.
5. **Quote in USD.** Always.

## Tracking

A file is enough. `clients.md`, one line each:

```
2026-09-20 | r/excel | US clinic, rota sheet | answered publicly | -
2026-09-21 | r/smallbusiness | UK agency, invoicing | emailed | no reply
2026-09-24 | referral | AU trades, job scheduling | AUDIT SOLD $250 | -> build?
```

The only metric worth watching early is **public answers given per week**.
Everything downstream follows from it, and it is the only number fully within
your control.

## The first milestone

**One Audit. $250 — about Rs 21,700.**

That is more than twice the entire starting balance. It is also the moment the
business stops being a plan and starts being a business, which matters more.
