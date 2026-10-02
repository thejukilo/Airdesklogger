import { useEffect } from "react";
import { Link } from "react-router-dom";

/**
 * FOCA acceptance status. The application has been SUBMITTED to FOCA but not yet
 * accepted, so this stays `false` and the page makes only truthful "built to /
 * submitted for" claims — never "approved". The day FOCA grants acceptance, set
 * this to `true` and fill in FOCA_REFERENCE; the hero badge, the compliance band
 * and the FAQ all switch to the accepted wording automatically.
 */
const FOCA_APPROVED = false;
const FOCA_REFERENCE = ""; // e.g. "FOCA ref. 31-00-0000" once granted

/**
 * Public landing page. Served bare (it brings its own header/footer) at
 * "/landing" today, and intended to become "/" once FOCA review completes.
 *
 *   1. Hero         - what the product is, primary CTAs
 *   2. Compliance   - the regulatory standing (EASA Part-FCL / FOCA)
 *   3. Features     - the regulatory and workflow features in one grid
 *   4. Pricing      - single plan with the accepted payment methods
 *   5. FAQ + Footer
 *
 * No external assets; uses the same brand palette as the signed-in app so the
 * visual jump from landing to app is seamless.
 */
export function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Airdesk Logger — EASA Part-FCL digital pilot logbook";
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-slate-50 to-slate-100 text-ink">
      <TopBar />
      <Hero />
      <Compliance />
      <Features />
      <Pricing />
      <Faq />
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between px-4 py-3">
        <Link to="/landing" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">
            Airdeck<span className="font-normal text-slate-500"> Logger</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <a href="#compliance" className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline">Compliance</a>
          <a href="#features" className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline">Features</a>
          <a href="#pricing" className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline">Pricing</a>
          <Link to="/login" className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Sign in</Link>
          <Link to="/register" className="rounded-md bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
            Start free trial
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-screen-xl px-4 pb-12 pt-16 sm:pt-24">
      <div className="grid items-center gap-12 md:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600"></span>
            {FOCA_APPROVED ? "Accepted by FOCA · Switzerland" : "Built to the FOCA logbook standard"}
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Your pilot logbook, <span className="text-brand-600">done right.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Airdesk Logger is an electronic flight logbook for EASA Part-FCL
            licence holders. AMC1 FCL.050 layout, cryptographic sign-off, a
            tamper-evident audit trail, and a FOCA-format PDF export — at a
            price every pilot can afford.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/register" className="rounded-md bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700">
              Start 3-day free trial
            </Link>
            <Link to="/register?plan=paid" className="rounded-md border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
              Subscribe — CHF 5.99 / mo
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Trial · no card required · cancel anytime — or skip the trial and pay directly
          </p>
        </div>
        <div className="hidden md:block">
          <HeroIllustration />
        </div>
      </div>
    </section>
  );
}

function Compliance() {
  const pillars = [
    {
      title: "EASA Part-FCL",
      body: "AMC1 FCL.050 column layouts for aeroplane, helicopter, sailplane and balloon — with computed per-page, brought-forward and grand totals.",
      icon: <IconColumns />,
    },
    {
      title: "FOCA logbook standard",
      body: "Built to FOCA's GM/INFO “Accepted Logbook Formats” requirements (Article 2): record content, integrity, retention and the official PDF export.",
      icon: <IconDocument />,
    },
    {
      title: "Tamper-evident by design",
      body: "Ed25519 instructor sign-off and a SHA-256 hash-chained audit ledger make every entry and every correction provable — auditors can verify it offline.",
      icon: <IconChain />,
    },
    {
      title: "Swiss, and yours",
      body: "Operated from Switzerland. Export the full FOCA PDF whenever you like, and your records remain yours — readable and exportable even if you cancel.",
      icon: <IconShield />,
    },
  ];
  return (
    <section id="compliance" className="border-y border-slate-200/60 bg-white py-20">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">Regulatory standing</span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Made for the authorities, not just pilots</h2>
          <p className="mt-3 text-base text-slate-600">
            Airdesk Logger is designed around Switzerland&rsquo;s FOCA logbook requirements and the EASA
            Part-FCL rules &mdash; by design from day one, not retrofitted.
          </p>
        </div>

        {/* Authority / approval status card */}
        <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-50 to-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
            <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
              <IconSeal />
            </div>
            <div className="min-w-0">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  FOCA_APPROVED ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${FOCA_APPROVED ? "bg-emerald-600" : "bg-amber-500"}`}></span>
                {FOCA_APPROVED ? "Accepted" : "Acceptance in review"}
              </span>
              <h3 className="mt-2 text-xl font-bold tracking-tight">
                {FOCA_APPROVED
                  ? "Accepted by FOCA — Switzerland"
                  : "Submitted to FOCA for acceptance"}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {FOCA_APPROVED ? (
                  <>
                    Accepted as an electronic logbook by the <strong>Federal Office of Civil Aviation
                    (FOCA)</strong>, Switzerland&rsquo;s civil aviation authority and an EASA member state.
                    {FOCA_REFERENCE ? <> {FOCA_REFERENCE}.</> : null}
                  </>
                ) : (
                  <>
                    Airdesk Logger has been submitted to the <strong>Federal Office of Civil Aviation
                    (FOCA)</strong> &mdash; Switzerland&rsquo;s civil aviation authority and an EASA member
                    state &mdash; for acceptance as an electronic logbook under its GM/INFO guidance, and is
                    built to that standard throughout.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">{p.icon}</div>
              <h3 className="mt-4 text-base font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      title: "AMC1 FCL.050 column layout",
      body: "Aeroplane, helicopter, sailplane and balloon — each category in its own layout, with auto-classified day / night landings and night-time minutes.",
      icon: <IconColumns />,
    },
    {
      title: "Cryptographic sign-off",
      body: "Instructors and examiners sign with Ed25519 keys, MFA-protected. The signature commits to the exact entry version — tampering breaks it.",
      icon: <IconShield />,
    },
    {
      title: "Tamper-evident audit trail",
      body: "Every change appends one record to a SHA-256 hash-chained ledger. The history is provable, not just stored. Auditors can verify it offline.",
      icon: <IconChain />,
    },
    {
      title: "FOCA-format PDF export",
      body: "Generate the FOCA logbook PDF on demand, with the full change-log appendix, sign-off appendix and attributes appendix — ready for dLIS submission.",
      icon: <IconDocument />,
    },
    {
      title: "Flight-school import",
      body: "Personal access tokens let your flight school post flights directly. Write-only, append-only, per-pilot — your school never sees anyone else's logbook.",
      icon: <IconImport />,
    },
    {
      title: "Local time, the right way",
      body: "Enter times in UTC or local civil time at the aerodrome. We convert against the airport's IANA timezone, automatically and accurately.",
      icon: <IconClock />,
    },
  ];
  return (
    <section id="features" className="border-t border-slate-200/60 bg-white py-20">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything an EASA logbook should be</h2>
          <p className="mt-3 text-base text-slate-600">
            Built around the regulatory requirements rather than retrofitted.
            The features below cover the FOCA 2.x guidance and AMC1 FCL.050 by
            design, not by accident.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">{f.icon}</div>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const bullets = [
    "Unlimited flight entries and FSTD sessions",
    "Unlimited FOCA PDF exports",
    "Sign-off workflow with Ed25519 cryptography",
    "Flight-school import API",
    "Cancel anytime — your entries always stay yours",
  ];
  return (
    <section id="pricing" className="border-t border-slate-200/60 bg-gradient-to-b from-slate-50 to-white py-20">
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">One simple plan</h2>
          <p className="mt-3 text-base text-slate-600">
            No tiers, no add-ons, no surprises. Start with a 3-day free trial
            — no card required.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-lg">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
            <div className="bg-ink px-8 py-7 text-white">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Full access</span>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-bold">CHF 5.99</span>
                <span className="text-sm text-slate-300">/ month</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">Cancel anytime · all features included</p>
            </div>
            <div className="space-y-3 px-8 py-7">
              {bullets.map((b) => (
                <div key={b} className="flex items-start gap-3">
                  <div className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor"><path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4l2.3 2.3 6.3-6.3a1 1 0 0 1 1.4 0z"/></svg>
                  </div>
                  <span className="text-sm text-slate-700">{b}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 px-8 py-6">
              <Link to="/register" className="block w-full rounded-xl bg-brand-600 py-3 text-center text-base font-semibold text-white shadow-sm hover:bg-brand-700">
                Start 3-day free trial
              </Link>
              <p className="mt-3 text-center text-xs text-slate-500">
                No card required to start. We'll ask for it when your trial ends.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200"></span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">or</span>
                <span className="h-px flex-1 bg-slate-200"></span>
              </div>
              <Link to="/register?plan=paid" className="mt-4 block w-full rounded-xl border border-slate-300 bg-white py-3 text-center text-base font-semibold text-slate-700 hover:bg-slate-50">
                Subscribe immediately — CHF 5.99
              </Link>
              <p className="mt-2 text-center text-xs text-slate-500">
                Skip the trial and start paying right away.
              </p>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-8 py-5">
              <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Pay with</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <PaymentBadge label="TWINT" bg="bg-white" text="text-ink" weight="font-extrabold" />
                <PaymentBadge label="VISA" bg="bg-white" text="text-[#1A1F71]" weight="font-extrabold" />
                <PaymentBadge label="MASTERCARD" bg="bg-white" text="text-ink" weight="font-bold" />
                <PaymentBadge label="PayPal" bg="bg-white" text="text-[#003087]" weight="font-extrabold" />
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">VAT included where applicable.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PaymentBadge({ label, bg, text, weight }: { label: string; bg: string; text: string; weight: string }) {
  return (
    <span className={`inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-xs tracking-wider ${bg} ${text} ${weight}`}>
      {label}
    </span>
  );
}

function Faq() {
  const items = [
    { q: "What happens after the 3-day trial?", a: "We ask for a payment method. If you don't add one, your logbook switches to read-only — you can still view your entries and the PDF you generated, but you can't log new flights. Subscribe at any time to restore full access." },
    { q: "Can I cancel anytime?", a: "Yes, in two clicks from your profile. You keep full access until the end of the paid month, then the logbook becomes read-only. Your entries are never deleted." },
    {
      q: "Is this approved by FOCA?",
      a: FOCA_APPROVED
        ? `Yes. Airdesk Logger is accepted as an electronic logbook by FOCA, Switzerland's civil aviation authority (an EASA member state)${FOCA_REFERENCE ? ` — ${FOCA_REFERENCE}` : ""}. It is built against AMC1 FCL.050, the FOCA GM/INFO guidance and BFCL.050.`
        : "It has been submitted to FOCA (Switzerland's civil aviation authority, an EASA member state) for acceptance as an electronic logbook, and is built against AMC1 FCL.050, the FOCA GM/INFO guidance and BFCL.050 from day one. We will update this page the moment acceptance is granted.",
    },
    { q: "Can I import flights from my flight school's system?", a: "Yes. Generate a personal access token in your account, paste it into your school's logbook software, and closed flights will flow into your Airdesk logbook automatically." },
    { q: "What about my existing logbook?", a: "You can log historic flights one by one or, if your school uses a supported system, bulk-import through the API." },
  ];
  return (
    <section className="border-t border-slate-200/60 bg-white py-20">
      <div className="mx-auto max-w-screen-md px-4">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked</h2>
        <dl className="mt-8 space-y-6">
          {items.map((it) => (
            <div key={it.q} className="rounded-xl border border-slate-200 bg-white p-5">
              <dt className="text-base font-semibold">{it.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600">{it.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200/60 bg-slate-50 py-10">
      <div className="mx-auto flex max-w-screen-xl flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-medium tracking-tight">Airdeck Logger</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
          <a href="mailto:lode@jukilo.com" className="hover:text-slate-700">Contact</a>
          <Link to="/login" className="hover:text-slate-700">Sign in</Link>
          <a href="#compliance" className="hover:text-slate-700">Compliance</a>
          <a href="#pricing" className="hover:text-slate-700">Pricing</a>
          <a href="#features" className="hover:text-slate-700">Features</a>
        </div>
        <p className="text-xs text-slate-400">© 2026 Jukilo · Switzerland</p>
      </div>
    </footer>
  );
}

/* ──────────── Icons & illustration (inline SVG, no asset deps) ──────────── */

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
      <svg viewBox="0 0 22 22" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M3 11L11 3L19 11L11 19L3 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 11L11 7L15 11L11 15L7 11Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function HeroIllustration() {
  return (
    <div className="relative rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Logbook · May 2026</div>
          <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Signed</div>
        </div>
        {[
          { date: "29 May", reg: "HB-PNT", from: "LSZH", to: "LSGG", time: "1:20", tag: "PIC", tagBg: "bg-brand-50", tagText: "text-brand-700" },
          { date: "23 May", reg: "HB-PEW", from: "LSZN", to: "LSZF", time: "0:38", tag: "Dual", tagBg: "bg-amber-50", tagText: "text-amber-700" },
          { date: "21 May", reg: "HB-PNT", from: "LSZH", to: "LSZH", time: "1:10", tag: "PIC", tagBg: "bg-brand-50", tagText: "text-brand-700" },
          { date: "13 May", reg: "FSTD A320", from: "OPC", to: "—", time: "4:00", tag: "Sim", tagBg: "bg-slate-100", tagText: "text-slate-700" },
        ].map((r) => (
          <div key={r.date + r.reg} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm shadow-sm">
            <div className="flex items-center gap-3">
              <span className="w-14 text-xs font-semibold tabular-nums text-slate-500">{r.date}</span>
              <div>
                <div className="font-semibold tabular-nums">{r.reg}</div>
                <div className="text-xs text-slate-500">{r.from} → {r.to}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${r.tagBg} ${r.tagText}`}>{r.tag}</span>
              <span className="w-12 text-right font-bold tabular-nums">{r.time}</span>
            </div>
          </div>
        ))}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-500">Total this page</span>
          <span className="font-bold tabular-nums">7:08</span>
        </div>
      </div>
    </div>
  );
}

function IconColumns() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/></svg>;
}
function IconShield() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>;
}
function IconChain() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>;
}
function IconDocument() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>;
}
function IconImport() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>;
}
function IconClock() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
}
function IconSeal() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l2.4 1.8 3 .2.9 2.9 2.3 1.9-1 2.8 1 2.8-2.3 1.9-.9 2.9-3 .2L12 22l-2.4-1.8-3-.2-.9-2.9L3.4 15.2l1-2.8-1-2.8 2.3-1.9.9-2.9 3-.2z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  );
}
