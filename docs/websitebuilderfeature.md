BuddyCallAI
Talk to AI. Just Call.
WEBSITE BUILD SPECIFICATION
Complete Developer Guide for Registration, AWS Integration, Dashboard & Affiliate Program
Built by Brash3D Media Group  |  Version 2.0  |  2025


Table of Contents

01	Project Overview & Brand Identity	3
02	Complete Website Sections & Content	4
03	Phone Numbers & Countries	6
04	User Registration & Authentication	7
05	Dashboard — Call History, Balance & Minutes	10
06	Subscription Plans & Billing (Stripe)	12
07	SMS Alert System — Low Time Warning	13
08	Coupon / Promo Code System	14
09	Affiliate Program — 5% / 7% / 9% Commission	15
10	Language Support — English & Spanish	17
11	AWS Infrastructure Setup	18
12	SEO & Schema.org Implementation	20
13	Terms of Service & Privacy Policy	22
14	API Endpoints Reference	23
15	Database Schema	25
16	Security Requirements	27
17	Deployment Checklist	28
 
01 — Project Overview & Brand Identity

BuddyCallAI is an AI-powered voice assistant accessible by regular telephone call. Users dial a dedicated number, speak naturally, and receive intelligent AI responses in real time — no app, no internet connection, no typing required. The website must serve as the product's primary marketing and conversion hub, with complete user registration, account management, and affiliate program.

1.1  Brand Identity
Item	Value
Product Name	BuddyCallAI
Website URL	www.buddycallai.com
Brand Colors	Primary: #4FC3F7 (Cyan)  |  Background: #0B0D16 (Dark Navy)  |  Accent: #00E5A0 (Green)
Font Family	Sora (headings, bold) + DM Sans (body) — load from Google Fonts
Slogan	Talk to AI. Just Call.
Toll Free Number	1 (866) 58ASK-AI  →  1 (866) 582-7524
USA Number	+1 (320) 372-7524
USA Español	+1 (414) 742-7542
Canada	+1 (581) 202-7524
Email	info@buddycallai.com
WhatsApp	+57 318 285 4232  (wa.me/573182854232)
Operator	Brash3D Media Group
Languages	English (default)  +  Spanish (Español)
Available In	United States  +  Canada ONLY
Free Trial	First 1 minute free — no credit card required

 
02 — Complete Website Sections & Content

The website is a single-page application (SPA) with smooth scroll navigation. Every section below must be built exactly as specified. The developer has the full production-ready HTML file as reference.

2.1  Navigation Header (Sticky)
•	Logo: hexagonal waveform SVG icon + "BuddyCall.ai" text with "Call" in cyan
•	Nav links: How it Works · Pricing · Features · Countries · Earn 💰 (affiliate, green color)
•	Language switcher: EN 🇺🇸 / ES 🇺🇸 — only two languages
•	Sign In button — opens auth modal on click
•	After login: button changes to show user initials + "Dashboard"

2.2  Hero Section
•	Animated badge: "Now Live — Demo Available"
•	Headline: "Talk to Artificial Intelligence as Easily as Calling a Friend."
•	Subtext: "No apps. No typing. No setup. Just pick up your phone and call your AI assistant — available 24/7."
•	CTA buttons: "Call AI Now" (primary, cyan) + "How it Works ↓" (secondary)
•	Toll Free display: 🆓 Toll Free: 1 (866) 58ASK-AI
•	Subtext: "First 1 minute free · No credit card required"
•	Country pills: 🇺🇸 USA · 🇨🇦 Canada ONLY (no other countries)
•	Dark background with animated hexagonal grid pattern

2.3  Live Demo Section
•	"First 1 Minute Free" badge
•	Animated phone ring icon
•	Phone number: 📞 1 (866) 58ASK-AI — Toll Free · Available 24/7
•	Description: "No app needed. No signup required. Just call and experience AI conversation."
•	Tagline: "Powered by Brash3D Media Group."

2.4  How It Works (3 Steps)
Step	Title	Description
1	Call the Number	Dial your country's BuddyCallAI number from any phone. No app download, no account needed for the demo.
2	Ask Anything	Speak naturally. Ask questions, get help, have a conversation. Deepgram transcribes your voice in real time.
3	AI Responds Instantly	ElevenLabs generates a natural, human-like voice response in milliseconds. Smarter than any hotline.

2.5  Features Section
•	Natural conversations — multi-turn, context-aware
•	24/7 AI availability — always on
•	No apps required — any phone works (landline, mobile, VoIP)
•	Works in USA and Canada
•	Human-like voice — ElevenLabs technology
•	Right side: animated live chat mockup with AI waveform bars

2.6  Use Cases Section
Use Case	Headline	Description
Students	AI at 2am — no judgment	Ask complex questions before exams. Get clear explanations in plain English.
Entrepreneurs	Business advice on your commute	Get strategic insights, brainstorm ideas, draft emails — all hands-free.
Seniors	No smartphone? No problem	If you can dial a number, you can talk to AI. Works on any phone.
Travelers	Lost abroad with no WiFi?	Call AI for directions, translation, restaurant recommendations — no data needed.

 
2.7  Pricing Section
Feature	Starter $9/mo	Pro $29/mo	Gold $79/mo
AI Conversation	30 minutes	2 hours	10 hours
Phone Numbers	1	3	6
Emails (for transcripts)	1	3	6
Voice Quality	Standard	Premium ElevenLabs	Ultra HD
Call History	Yes	Yes	Yes
Transcripts to Email	Per phone number	Per phone number	Per phone number
Support	Email	Priority	24/7 Dedicated
Custom AI Persona	No	Yes	Yes
API Access	No	No	Yes
White-Label	No	No	Yes
Analytics	Basic	Advanced	Full Suite
SMS Time Alerts	5 min + 2 min warning	5 min + 2 min warning	5 min + 2 min warning
Coupon field in signup	Yes	Yes	Yes
NOTE:  Pro plan is "Most Popular" — feature it with a cyan border, slightly scaled up, and a badge.

2.8  Technology Section
9 cards in a 4-column grid. Each card shows only the technology logo + name. No descriptions (except Brash3D which spans all 4 columns with a description).
Card #	Technology	Logo Style	Span
1	Twilio	Red circle with 4 white dots	1 col
2	ElevenLabs	Black card, vertical bars (11)	1 col
3	Deepgram	Green "D" waveform mark	1 col
4	Amazon AWS	Orange "aws" wordmark with smile arrow	1 col
5	ChatGPT	OpenAI gear in green #10A37F	1 col
6	Gemini	Google gradient diamond sparkle	1 col
7	n8n	Two connected nodes, "8" in orange	1 col
8	Claude	Anthropic sunburst in amber #D28C5E	1 col
9	Brash3D Media Group	3D geometric hexagonal logo in cyan — FEATURED CARD	FULL 4 columns

2.9  Global Launch — Phone Numbers Section
IMPORTANT:  ONLY show these 4 numbers. Do NOT include UK, Germany, France, Mexico, or South Africa.
Number	Type	Clickable Link	Status
1 (866) 58ASK-AI  /  1 (866) 582-7524	Toll Free USA (FEATURED — span 2 columns)	tel:+18665827524	🟢 Live
+1 (320) 372-7524	USA Local	tel:+13203727524	🟢 Live
+1 (414) 742-7542	USA Español — "Hablamos español"	tel:+14147427542	🟢 Live
+1 (581) 202-7524	Canada	tel:+15812027524	🟢 Live
NOTE:  The Toll Free card must be featured with cyan border + glow, and span 2 grid columns. Each number must be a clickable tel: link.

2.10  Coupon / Promo Code Section
A dedicated section before the CTA banner. Contains an input field and Apply button. Pre-loaded demo codes available for testing.
Code	Discount	Description
LAUNCH50	50% off first month	Launch promotion
BUDDY30	30% off	Welcome gift
FIRSTCALL	100 free bonus minutes	New user bonus
BRASH3D	20% off	Partner code
AI2025	15% off	Early adopter discount
NOTE:  On successful code entry: show green confirmation message and auto-open signup modal. On failure: show red error message.

 
03 — Phone Numbers & Countries

IMPORTANT:  The website, registration dropdown, language switcher, hero pills, and all meta/schema must reflect ONLY USA and Canada. Remove all other countries from every element.

Element	Allowed Values
Hero country pills	🇺🇸 USA  |  🇨🇦 Canada — only these two
Signup country dropdown	🇺🇸 United States  |  🇨🇦 Canada — only these two
Language switcher	EN 🇺🇸 English  |  ES 🇺🇸 Español — only two options
meta geo.region	US, CA
meta geo.placename	USA, Canada
Schema.org countries	United States + Canada only
hreflang tags	en, es, en-US, en-CA, es-US, x-default

 
04 — User Registration & Authentication

4.1  Auth Modal — Two Tabs
•	Tab 1: Sign In — email + password + "Forgot password?" link
•	Tab 2: Create Account — full registration form (see below)
•	After successful login or signup: header button changes to user initials + "Dashboard" text
•	Clicking header button opens Dashboard modal

4.2  Registration Fields (All Plans)
Every registration form — regardless of plan — must collect the following personal information fields FIRST:
Field	Type	Validation
First Name	Text input	Required, 2–60 characters
Last Name	Text input	Required, 2–60 characters
Country	Dropdown select	Required — United States or Canada ONLY
Password	Password input	Required, min 8 chars, 1 uppercase, 1 number

4.3  Plan Selector
•	Three plan options displayed as clickable cards: Starter $9/mo · Pro $29/mo · Gold ✦ $79/mo
•	Default selected: Pro
•	Selecting a plan dynamically changes the phone number + email rows below (see Section 4.4)

4.4  Phone Number + Email Rows (Per Plan)
IMPORTANT:  This is the most critical part of registration. Each phone number has its OWN dedicated email address. Every transcript for that number goes ONLY to its paired email.

Plan	Phone Lines	Email Addresses	Rule
Starter	1 telephone number	1 email address	1 pair: Phone 1 + Email 1
Pro	3 telephone numbers	3 email addresses	3 pairs: Phone 1+Email 1, Phone 2+Email 2, Phone 3+Email 3
Gold	6 telephone numbers	6 email addresses	6 pairs: one email per phone — all independent

Each row in the form displays side-by-side:
Left field	Right field
Telephone Number N  (tel input, required)	Email for Line N Transcripts  (email input, required)

NOTE:  When user switches plan, the rows must update instantly via JavaScript — Starter shows 1 row, Pro shows 3 rows, Gold shows 6 rows. Row 1 is labeled "Primary Line".

4.5  Additional Registration Fields
Field	Type	Notes
Coupon Code	Text input (optional)	Uppercase auto-format. Validated on submit. Applied at Stripe checkout.
Terms Agreement	Checkbox (required)	Links open Terms of Service and Privacy Policy modals inline (not new page)

4.6  Registration Flow (Step by Step)
1.	User selects plan (Starter / Pro / Gold)
2.	User fills personal info: First Name, Last Name, Country, Password
3.	User fills phone+email pairs (1, 3, or 6 depending on plan)
4.	User optionally enters coupon code
5.	User checks Terms agreement
6.	Form submitted → backend validates all fields
7.	If coupon entered: validate against coupons table in DB
8.	Password hashed with bcrypt (12 salt rounds)
9.	User record created with status = pending_payment
10.	Stripe Checkout session created for selected plan
11.	After successful Stripe payment: status = active, minutes allocated, confirmation email sent via AWS SES
12.	User redirected to dashboard with JWT token in httpOnly cookie

4.7  Login Flow
13.	User enters email + password
14.	Backend validates credentials, compares bcrypt hash
15.	On success: JWT token issued (24hr expiry), stored in httpOnly Secure cookie
16.	User dashboard opens automatically
17.	Header button updates to show initials + "Dashboard"

 
05 — Dashboard — Call History, Balance & Minutes

The Dashboard is a modal window that opens when a logged-in user clicks their name/initials in the header. It must pull live data from the AWS backend via API calls on load.

5.1  Dashboard Header
Element	Content
User Avatar	Circle showing first 2 initials of user name — cyan background
Display Name	Full name from account (First + Last)
Plan Badge	e.g. "Pro Plan · Active" — plan name in cyan
Next Billing	Date of next subscription renewal

5.2  Stats Cards (3 cards, displayed side by side)
Card	Data Source	Display	Color
Minutes Left	GET /api/v1/user/time-balance → seconds_remaining ÷ 60	Number (e.g. "87 min")	Cyan
Total Calls	GET /api/v1/user/calls → count	Integer count	White
Phone Numbers	GET /api/v1/user/profile → phone_numbers.length	Integer count	Green

5.3  Time Balance Progress Bar
•	Bar fills from 0% to 100% based on (minutes_remaining / total_plan_minutes) × 100
•	Label left: "X used"  |  Label right: "Y total"
•	Bar color: cyan when >30% remaining, amber when 10–30%, red when <10%
•	API: GET /api/v1/user/time-balance

5.4  My Registered Numbers
•	Show all phone numbers registered to this account
•	Each displayed as a clickable pill with the phone number
•	A "+ Add Number" pill (if slots available for their plan)
•	API: GET /api/v1/user/profile → phone_numbers array

5.5  Call History Table
Table showing the user's recent calls, with columns:
Column	Source	Notes
Date & Time	call_sessions.start_time	Format: Mar 22, 2025 · 10:42am
Duration	call_sessions.duration_seconds ÷ 60	Format: 4m 12s
Number Called From	call_sessions.called_number	Show the BuddyCallAI number dialed
Status	call_sessions.status	Badge: green "Completed" / cyan "In Progress"
Transcript	call_sessions.transcript_sent	Link "View →" opens transcript if available
•	API: GET /api/v1/user/calls
•	Transcripts: GET /api/v1/user/transcripts
•	Show last 10 calls by default, with "Load more" button

5.6  Dashboard Action Buttons
Button	Action	Style
Upgrade Plan	Opens plan selection / Stripe checkout	Primary cyan
Recharge Minutes	Opens recharge/add-minutes flow	Outline cyan
Settings	Opens account settings page	Outline cyan
Sign Out	Clears JWT cookie, resets header button to "Sign In"	Red outline

5.7  Developer Notes — API Wiring
NOTE:  All dashboard data must be fetched via authenticated API calls on modal open. Never hardcode or use placeholder data in production. Use GET /api/v1/user/profile for name, plan, phone numbers. Use GET /api/v1/user/time-balance for minutes. Use GET /api/v1/user/calls for call history.

 
06 — Subscription Plans & Billing (Stripe)

6.1  Stripe Configuration
Item	Value
Billing Cycle	Monthly, auto-renews
Currency	USD
Starter Product ID	prod_starter (create in Stripe dashboard)
Pro Product ID	prod_pro
Gold Product ID	prod_gold
Starter Price	$9.00/month — allocates 1,800 seconds (30 min)
Pro Price	$29.00/month — allocates 7,200 seconds (2 hours)
Gold Price	$79.00/month — allocates 36,000 seconds (10 hours)

6.2  Stripe Webhook Events to Handle
Event	Action
checkout.session.completed	Set user status = active, allocate call seconds, send welcome email
invoice.paid	Top up call seconds for renewal month, reset alert flags
customer.subscription.deleted	Set user status = cancelled
payment_intent.payment_failed	Send payment failure email, suspend account after 3 days
customer.subscription.updated	Update plan in DB if upgraded/downgraded

 
07 — SMS Alert System — Low Time Warning

IMPORTANT:  This is CRITICAL functionality. Users must be warned before their time runs out so they can recharge. All SMS go to the user's REGISTERED phone number — NOT the AI number they called.

7.1  Alert Triggers & SMS Content
Trigger	When	SMS Message Sent to Registered Phone
5-Minute Warning	seconds_remaining reaches 300	[BuddyCallAI] You have 5 minutes of AI talk time left. Recharge now: buddycallai.com/recharge  Reply STOP to opt out.
2-Minute Warning	seconds_remaining reaches 120	[BuddyCallAI] URGENT: Only 2 minutes left! Your call will end soon. Recharge: buddycallai.com/recharge  Reply STOP to opt out.
Time Expired	seconds_remaining reaches 0	[BuddyCallAI] Your time has run out. Your call has ended. Recharge to keep talking: buddycallai.com/recharge  Reply STOP to opt out.
Recharge Confirmation	After successful payment/recharge	[BuddyCallAI] Account recharged! You now have [X] hours of AI talk time. Call [number] to resume!  Reply STOP to opt out.

7.2  Implementation
•	Track active calls via call_sessions table. On each 10-second tick, check seconds_remaining.
•	Use AWS Lambda + EventBridge (every 60s) OR real-time WebSocket counter per active call
•	Store alert_5min_sent and alert_2min_sent flags in users table to prevent duplicate SMS
•	On time = 0: use Twilio API to update active call with TwiML: <Say>Your time is up.</Say><Hangup/>
•	SMS sent via Twilio Messaging API from the country-specific BuddyCallAI number
•	Log all SMS sends to sms_log table
•	A2P 10DLC registration required for USA SMS before going live

 
08 — Coupon / Promo Code System

8.1  How It Works
18.	User enters code in the Coupon Section on the homepage OR in the coupon field during signup
19.	Frontend validates against known codes instantly (show success/error message)
20.	On signup: coupon passed to backend, validated against coupons DB table
21.	Valid coupon → apply discount to Stripe Checkout session via coupon ID or discount object
22.	Store coupon_used field in user record for audit

8.2  Pre-Loaded Coupon Codes
Code	Discount Type	Value	Description
LAUNCH50	Percentage	50% off first month	Launch promotion
BUDDY30	Percentage	30% off	Welcome gift
FIRSTCALL	Minutes	100 bonus minutes added	New user bonus
BRASH3D	Percentage	20% off	Partner discount
AI2025	Percentage	15% off	Early adopter

8.3  Coupon Homepage Section Design
•	Section label: "Special Offer"
•	Heading: "Have a coupon code?"
•	Subtext: "Enter your promo code below to unlock a discount on any plan. Codes are applied at checkout."
•	Input field: uppercase auto-format, 20 char max, placeholder "Enter promo code…"
•	Button: "Apply →" — cyan background
•	Success message (green): "✓ Code applied! [Description]" — then auto-open signup modal
•	Error message (red): "✗ Invalid code. Please check and try again."
•	Quick-click demo codes shown below input for testing: LAUNCH50 · BUDDY30 · FIRSTCALL

 
09 — Affiliate Program — 5% / 7% / 9% Commission

IMPORTANT:  Commission rates are FIXED: Starter = 5%, Pro = 7%, Gold = 9%. These rates are different from each other and must be displayed accurately everywhere.

9.1  Commission Structure
Plan Referred	Subscription Price	Commission Rate	Affiliate Earns / Month
Starter	$9.00/mo	5%	$0.45/mo recurring per referral
Pro	$29.00/mo	7%	$2.03/mo recurring per referral
Gold ✦	$79.00/mo	9%	$7.11/mo recurring per referral

9.2  Affiliate Program Rules
•	Cookie duration: 90 days from first click of affiliate link
•	Commission type: recurring — earned every month the referred user keeps their subscription
•	Minimum payout threshold: $20 USD
•	Payout schedule: monthly, via PayPal or bank transfer
•	Self-referrals are prohibited — accounts terminated immediately if detected
•	Fraudulent traffic or incentivized clicks are prohibited
•	BuddyCallAI may modify commission rates with 30 days written notice

9.3  Affiliate Section on Homepage
•	Section ID: #affiliates — reachable via nav link "Earn 💰" (green text in nav)
•	Left column: 3 steps (Get link → Share → Get paid monthly), CTA button "Join Affiliate Program →"
•	Right column: Commission table + Interactive Earnings Calculator

9.4  Earnings Calculator
•	Slider: 1 to 100 Pro subscribers referred
•	Monthly earnings = n × $2.03 (Pro 7%)
•	Annual earnings = monthly × 12
•	Updates live as slider moves — round to nearest dollar
•	Show stat cards: Monthly Earnings (green) + Annual Earnings (cyan)

9.5  Affiliate Backend Requirements
Requirement	Details
Affiliate signup	/affiliates page or via main dashboard — generate unique referral link
Link format	buddycallai.com/ref/{affiliate_code}
Click tracking	Log click to affiliate_clicks table: affiliate_id, timestamp, IP, user_agent
Cookie	Set 90-day cookie on visitor browser with affiliate_code value
Conversion	When referred user subscribes: create affiliate_commissions record with plan + rate
Commission calc	Starter: amount×0.05 | Pro: amount×0.07 | Gold: amount×0.09
Payout trigger	Monthly cron job: sum unpaid commissions ≥ $20, initiate PayPal/bank transfer
Dashboard	Affiliate sees: clicks, conversions, earnings (pending + paid), payout history

 
10 — Language Support — English & Spanish Only

IMPORTANT:  ONLY English and Spanish. Remove all French and German from the codebase, translations object, hreflang tags, and meta tags.

Item	English	Spanish
URL path	/ (default)	es/
hreflang	en, en-US, en-CA	es, es-US
Flag emoji	🇺🇸	🇺🇸
Hero badge	Now Live — Demo Available	En Vivo — Demo Disponible
Hero title	Talk to Artificial Intelligence…	Habla con Inteligencia Artificial…
Hero CTA	Call AI Now	Llama a la IA Ahora
Free trial	First 1 minute free	Primer minuto gratis
Available in	Available in: USA · Canada	Disponible en: USA · Canadá
Plans sub	Start free. Upgrade anytime.	Empieza gratis. Actualiza cuando quieras.
Section: How it Works	How It Works	Cómo Funciona
Section: Pricing	Pricing	Precios
Section: Affiliate	Earn Money	Ganar Dinero

NOTE:  Save language preference to localStorage and to the user account if logged in. Update html lang attribute on switch: en or es.

 
11 — AWS Infrastructure Setup

11.1  Required AWS Services
Service	Tier / Config	Purpose
EC2 Auto Scaling	t3.medium (min 2 instances)	Node.js API server — scale with traffic
RDS PostgreSQL	db.t3.medium Multi-AZ	Primary database — all user and call data
ElastiCache Redis	cache.t3.micro	Session storage, rate limiting, call time counters
S3 Bucket	Standard with versioning	Transcripts, recordings, static assets
CloudFront	Global CDN	Serve website worldwide at low latency
Lambda	Node.js 20.x	Call time checker, SMS dispatcher, transcript processor
EventBridge	Cron every 60s	Trigger Lambda for active call timer checks
SES	Production mode	Welcome emails, transcript delivery, alerts
Route 53	DNS + Health Check	buddycallai.com domain management
ACM	SSL Certificate	HTTPS for all domains
WAF	Managed Rules	Protect API from bots, rate limit abuse
Secrets Manager	Rotation enabled	All API keys (Twilio, Stripe, OpenAI, etc.)
CloudWatch	Alarms + Dashboard	Monitor errors, latency, call volume
VPC	Private subnets	Isolate RDS and ElastiCache

11.2  Environment Variables (AWS Secrets Manager)
Key	Value Description
TWILIO_ACCOUNT_SID	Twilio account identifier
TWILIO_AUTH_TOKEN	Twilio authentication token
TWILIO_PHONE_TOLLFREE	+18665827524 — Toll free USA
TWILIO_PHONE_USA	+13203727524 — USA local
TWILIO_PHONE_USA_ES	+14147427542 — USA Español
TWILIO_PHONE_CA	+15812027524 — Canada
STRIPE_SECRET_KEY	Stripe live secret key
STRIPE_WEBHOOK_SECRET	Stripe webhook signing secret
STRIPE_STARTER_PRICE_ID	Stripe price ID for $9 plan
STRIPE_PRO_PRICE_ID	Stripe price ID for $29 plan
STRIPE_GOLD_PRICE_ID	Stripe price ID for $79 plan
OPENAI_API_KEY	OpenAI ChatGPT key
ANTHROPIC_API_KEY	Claude (Anthropic) key
GOOGLE_GEMINI_API_KEY	Gemini key
ELEVENLABS_API_KEY	ElevenLabs voice synthesis key
ELEVENLABS_VOICE_ID	Selected voice ID
DEEPGRAM_API_KEY	Deepgram speech recognition key
JWT_SECRET	Min 64-char random string for JWT signing
DB_CONNECTION_STRING	PostgreSQL connection URL
REDIS_URL	ElastiCache Redis URL
AWS_SES_FROM_EMAIL	Verified sender: noreply@buddycallai.com

 
12 — SEO & Schema.org Implementation

12.1  Meta Tags (English — Default)
Tag	Value
title	BuddyCallAI — Talk to AI by Phone | USA & Canada | Affiliate Program 5–9%
meta description	BuddyCallAI — Talk to AI. Just Call. Dial 1 (866) 58ASK-AI to speak with AI instantly. No app, no typing. Available in USA & Canada. First 1 minute free. Affiliate program: earn 5–9% recurring commission. Powered by Brash3D Media Group.
meta keywords	AI phone call, talk to AI, AI assistant, call AI, voice AI, buddycallai, AI phone USA Canada, affiliate program AI 5 7 9 percent, Brash3D Media Group, hablar con IA sin app, afiliado buddycallai
meta author	BuddyCallAI — Brash3D Media Group
meta robots	index, follow, max-snippet:-1, max-image-preview:large
meta geo.region	US, CA
meta geo.placename	USA, Canada
og:title	BuddyCallAI — Talk to AI by Phone | USA & Canada | Earn 5–9% Affiliate
og:description	No apps. No typing. Call 1 (866) 58ASK-AI and talk to AI instantly. Available in USA & Canada. First 1 minute free. Join affiliate program!
og:type	website
og:url	https://www.buddycallai.com/
og:image	https://www.buddycallai.com/og-image.jpg (1200×630px)
og:locale	en_US
og:locale:alternate	es_US
twitter:card	summary_large_image

12.2  hreflang Tags
hreflang	URL
en	https://www.buddycallai.com/
es	https://www.buddycallai.com/es/
en-US	https://www.buddycallai.com/
en-CA	https://www.buddycallai.com/ca/
es-US	https://www.buddycallai.com/es/
x-default	https://www.buddycallai.com/

12.3  Schema.org Structured Data (8 Types)
Schema Type	Key Data
Organization	name: BuddyCallAI, url, telephone: +1-866-582-7524, email: info@buddycallai.com, sameAs, founder: Brash3D Media Group
WebSite	name, url, description, inLanguage: ["en","es"]
WebPage	name, url, description, isPartOf
SoftwareApplication	name, applicationCategory: Communication, operatingSystem: Any Phone, aggregateRating: 4.9/5 (128 reviews), offers: 3 plan offers
Service	name: BuddyCallAI AI Phone Service, areaServed: United States + Canada, availableLanguage: English + Spanish
HowTo	3 steps: Call → Ask → AI Responds
FAQPage	8+ questions in EN + ES about service, countries, pricing, affiliate program
WebPage (Affiliates)	/affiliates/ — name: BuddyCallAI Affiliate Program, description with 5%/7%/9% rates
Service (Affiliate)	Commission: 5% Starter, 7% Pro, 9% Gold — cookie: 90 days — payouts: monthly

 
13 — Terms of Service & Privacy Policy

Both legal documents are implemented as inline modals (not separate pages). They open when the user clicks the relevant footer link or the inline links in the signup form. They are already written in full and included in the HTML file. The developer must wire them correctly.

13.1  Terms of Service — Key Points
•	Governed by Florida law | Disputes via AAA arbitration in Orlando, FL
•	Service available: United States and Canada only
•	AI not a substitute for medical, legal, financial, or emergency advice
•	Call quality depends on carrier and signal strength — Brash3D Media Group not liable
•	Plan limits: Starter 30min, Pro 2hrs, Gold 10hrs — no rollover
•	SMS alerts at 5 min and 2 min before expiry
•	Affiliate program: 5% Starter, 7% Pro, 9% Gold — 90-day cookie — self-referral prohibited
•	Refunds: full within 48hrs if no calls made. No refund after usage.

13.2  Privacy Policy — Key Points
•	Operator: Brash3D Media Group — Headquarters: Orlando, Florida, USA
•	Offices: Toronto, Canada + Bogotá, Colombia
•	Data collected: First/Last name, country, phone numbers, emails, call transcripts, affiliate data
•	Per-line rule: each phone number paired with one email — transcripts go to matching email ONLY
•	Affiliate data: click tracking, conversion events, commission records retained 3 years
•	Third parties: Twilio (calls/SMS), AWS (hosting/email), Stripe (payments), OpenAI/Anthropic/Google (AI)
•	No data sold to third parties. No advertising cookies.
•	CCPA (California/USA) and PIPEDA (Canada) rights honored
•	Contact: info@buddycallai.com | WhatsApp: +57 318 285 4232

 
14 — API Endpoints Reference

NOTE:  All API routes are prefixed /api/v1. All routes except auth and Twilio/Stripe webhooks require: Authorization: Bearer <JWT token> in header.

14.1  Authentication Endpoints
Method	Endpoint	Auth	Description
POST	/auth/register	Public	Register new user — accepts plan, personal info, phone+email pairs, coupon
POST	/auth/login	Public	Login — returns JWT token
POST	/auth/logout	JWT	Invalidate token
POST	/auth/forgot-password	Public	Send password reset email via SES
POST	/auth/reset-password	Public	Reset password with token from email

14.2  User / Account Endpoints
Method	Endpoint	Auth	Description
GET	/user/profile	JWT	Full profile: name, plan, country, phone numbers, emails, status
PUT	/user/profile	JWT	Update name, country, language preference
GET	/user/time-balance	JWT	Returns seconds_remaining, total_seconds, percent_used
GET	/user/calls	JWT	List all calls — paginated, most recent first
GET	/user/transcripts	JWT	List transcripts — each with call_id and email it was sent to
POST	/user/add-number	JWT	Add phone+email pair (if plan allows remaining slots)
DELETE	/user/remove-number/:id	JWT	Remove a registered phone number

14.3  Billing Endpoints
Method	Endpoint	Auth	Description
POST	/billing/subscribe	JWT	Create Stripe Checkout session for selected plan
POST	/billing/cancel	JWT	Cancel Stripe subscription — effective end of billing period
POST	/billing/recharge	JWT	Purchase additional minutes — one-time Stripe payment
GET	/billing/history	JWT	List all invoices and payments
POST	/billing/apply-coupon	JWT	Validate and apply coupon to current or next invoice

14.4  Twilio & Communication Webhooks
Method	Endpoint	Auth	Description
POST	/twilio/inbound	Twilio Sig	Incoming call — identify user, check balance, start session
POST	/twilio/status	Twilio Sig	Call status callback — update session, deduct seconds
POST	/twilio/sms	Twilio Sig	Inbound SMS — handle STOP opt-out requests
POST	/stripe/webhook	Stripe Sig	Stripe payment events — see Section 6.2

14.5  Affiliate Endpoints
Method	Endpoint	Auth	Description
POST	/affiliate/apply	JWT	Apply to become an affiliate — generate unique code
GET	/affiliate/dashboard	JWT	Stats: clicks, conversions, pending earnings, paid earnings
GET	/affiliate/commissions	JWT	List all commission records with amounts and status
POST	/affiliate/payout-request	JWT	Request payout if balance ≥ $20
GET	/affiliate/ref/:code	Public	Track affiliate click, set 90-day cookie, redirect to homepage

 
15 — Database Schema (PostgreSQL)

TABLE: USERS
Column	Type	Description
id	UUID PK	Auto-generated primary key
first_name	VARCHAR(60)	Required
last_name	VARCHAR(60)	Required
country_code	CHAR(2)	US or CA only
password_hash	VARCHAR(255)	bcrypt hash, never plain text
plan	VARCHAR(20)	starter | pro | gold
status	VARCHAR(20)	pending | active | cancelled | suspended
seconds_remaining	INTEGER	Remaining call time in seconds
total_seconds	INTEGER	Plan allocation in seconds
stripe_customer_id	VARCHAR(50)	Stripe customer reference
stripe_subscription_id	VARCHAR(50)	Active Stripe subscription ID
alert_5min_sent	BOOLEAN DEFAULT false	Reset on renewal, set true when SMS sent
alert_2min_sent	BOOLEAN DEFAULT false	Reset on renewal, set true when SMS sent
coupon_used	VARCHAR(20)	Code used at signup, if any
preferred_language	CHAR(5)	en or es
affiliate_code	VARCHAR(20) UNIQUE	If affiliate — their unique referral code
referred_by	VARCHAR(20)	affiliate_code of whoever referred them
created_at	TIMESTAMPTZ	Account creation
updated_at	TIMESTAMPTZ	Last update

TABLE: USER_PHONE_NUMBERS
Column	Type	Description
id	UUID PK	Primary key
user_id	UUID FK	References users.id
phone_number	VARCHAR(30)	International format: +1XXXXXXXXXX
email_for_transcripts	VARCHAR(255)	Email where transcripts for THIS number are sent
line_number	INTEGER	1, 2, 3… (order in account)
is_primary	BOOLEAN	true for line 1
created_at	TIMESTAMPTZ	When added

TABLE: CALL_SESSIONS
Column	Type	Description
id	UUID PK	Session identifier
user_id	UUID FK	References users.id
phone_number_id	UUID FK	References user_phone_numbers.id (which line was called)
twilio_call_sid	VARCHAR(50)	Twilio call SID
caller_number	VARCHAR(30)	Number user called from
called_number	VARCHAR(30)	BuddyCallAI number dialed
start_time	TIMESTAMPTZ	Call start
end_time	TIMESTAMPTZ	Call end (null if active)
duration_seconds	INTEGER	Actual call duration
seconds_deducted	INTEGER	Billed to user
transcript	TEXT	Full call transcript
transcript_sent	BOOLEAN	Whether transcript was emailed
transcript_sent_to	VARCHAR(255)	Email transcript was sent to (matching phone number's email)
ai_engine	VARCHAR(20)	openai | anthropic | gemini
status	VARCHAR(20)	active | completed | failed

TABLE: AFFILIATE_COMMISSIONS
Column	Type	Description
id	UUID PK	Primary key
affiliate_user_id	UUID FK	The affiliate who earned this
referred_user_id	UUID FK	The user they referred
plan	VARCHAR(20)	Which plan the referred user subscribed to
commission_rate	DECIMAL(4,2)	0.05, 0.07, or 0.09
subscription_amount	DECIMAL(10,2)	e.g. 29.00
commission_amount	DECIMAL(10,2)	e.g. 2.03
billing_period	DATE	Month this commission applies to
status	VARCHAR(20)	pending | paid | cancelled
paid_at	TIMESTAMPTZ	When payout was processed

 
16 — Security Requirements

16.1  Authentication
•	All passwords: bcrypt with 12 salt rounds — never stored plain text
•	JWT tokens: httpOnly + Secure + SameSite=Strict cookies — never localStorage
•	Access token expiry: 24 hours | Refresh token: 30 days
•	CSRF protection on all state-changing endpoints
•	Rate limiting: 10 req/min on /auth/login | 5 req/min on /auth/register
•	Account lockout after 5 failed logins (15-minute lockout)
•	Email verification required before first call

16.2  API & Infrastructure
•	Twilio webhook validation via X-Twilio-Signature header — required
•	Stripe webhook validation via Stripe-Signature header — required
•	AWS WAF: rate limiting, geo-blocking, SQL injection prevention
•	VPC: RDS and ElastiCache in private subnets — no public internet exposure
•	All API keys in AWS Secrets Manager — never in .env or hardcoded
•	HTTPS enforced via CloudFront — all HTTP → HTTPS redirect
•	HSTS header: Strict-Transport-Security: max-age=31536000; includeSubDomains

16.3  Data & Privacy
•	Call transcripts: AES-256 encrypted at rest on S3
•	Phone numbers: column-level encryption in RDS
•	Payment data: never stored on servers — Stripe handles all card data (PCI DSS Level 1)
•	GDPR/CCPA/PIPEDA: data deletion endpoint, export endpoint, consent logging
•	Affiliate payout details (PayPal/bank): stored encrypted

 
17 — Deployment Checklist

AWS INFRASTRUCTURE
•	VPC with public + private subnets created
•	RDS PostgreSQL running in private subnet, Multi-AZ enabled
•	ElastiCache Redis in private subnet
•	EC2 Auto Scaling Group configured (min 2 instances)
•	S3 bucket: versioning + AES-256 encryption enabled
•	CloudFront distribution pointing to EC2 load balancer + S3
•	Route 53: A record for buddycallai.com → CloudFront
•	ACM SSL certificate issued and attached to CloudFront
•	All secrets loaded into AWS Secrets Manager
•	CloudWatch alarms: CPU >80%, error rate >1%, API latency >2s

TWILIO SETUP
•	All 4 numbers purchased: Toll Free + USA + USA-ES + Canada
•	Each number: inbound webhook → https://api.buddycallai.com/api/v1/twilio/inbound
•	Each number: status callback → https://api.buddycallai.com/api/v1/twilio/status
•	A2P 10DLC brand + campaign registered for USA SMS
•	STOP opt-out compliance tested on all numbers

THIRD-PARTY APIS
•	ElevenLabs: API key active, voice ID selected, streaming enabled
•	Deepgram: API key active, nova-2-phonecall model, real-time streaming
•	OpenAI: API key, gpt-4o-mini access confirmed
•	Stripe: products and prices created matching plan IDs, webhook registered
•	AWS SES: domain verified, sending limits raised for production

WEBSITE & REGISTRATION
•	EN and ES language versions working (/es/ path)
•	Registration flow tested end-to-end with real Stripe payment
•	Phone + email pair saving correctly per plan (1/3/6 lines)
•	Transcript delivery tested — each line sends to its own email
•	Dashboard loads real data from API (not placeholder)
•	SMS 5-min and 2-min alerts tested with real phone numbers
•	Coupon codes apply correctly at Stripe Checkout
•	Affiliate link tracking and commission calculation tested
•	Terms and Privacy Policy modals open from footer and signup form

SEO & ANALYTICS
•	sitemap.xml created and submitted to Google Search Console
•	robots.txt: allow all, reference sitemap
•	Google Analytics 4 with custom events: call_started, plan_purchased, affiliate_click, recharge_completed
•	Schema.org validation passed at schema.org/SchemaApp
•	Core Web Vitals passing (LCP <2.5s, FID <100ms, CLS <0.1)
•	og-image.jpg created (1200×630px) — dark BuddyCallAI branded card

Contact & Handoff
Website: www.buddycallai.com
Toll Free: 1 (866) 58ASK-AI  |  Phone: +1 (661) 422-6105
Email: info@buddycallai.com
WhatsApp: +57 318 285 4232 (wa.me/573182854232)
Offices: Orlando FL USA  |  Toronto Canada  |  Bogotá Colombia
Built by: Brash3D Media Group
The production-ready HTML file (buddycallai_website.html) accompanies this document and serves as the pixel-perfect reference for the developer.

