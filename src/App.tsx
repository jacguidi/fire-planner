// App.tsx — FIRE Planner (standalone)
import React, { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Download, RefreshCcw } from "lucide-react";

/* ---------------------------- tiny UI primitives --------------------------- */
function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={"rounded-2xl border bg-white " + (props.className || "")} />;
}
function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} className={"px-4 pt-4 " + (props.className || "")} />; }
function CardTitle(props: React.HTMLAttributes<HTMLDivElement>) { return <h2 {...props} className={"text-lg font-semibold " + (props.className || "")} />; }
function CardContent(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} className={"p-4 pt-2 " + (props.className || "")} />; }
function Label({ children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label {...rest} className={"text-sm text-slate-700 block mb-1 " + (rest.className || "")}>{children}</label>; }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-md border px-3 py-2 " +
        // 16px on mobile to prevent iOS zoom; smaller on md+
        "text-base md:text-sm " +
        "focus:outline-none focus:ring-2 focus:ring-slate-400 " +
        (props.className || "")
      }
      inputMode={props.type === "number" ? "decimal" : props.inputMode}
    />
  );
}
function Button({children, variant="default", ...rest}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: "default"|"secondary"|"ghost"}) {
  const base = "px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center";
  const styles = variant==="secondary" ? "bg-slate-100 hover:bg-slate-200" : variant==="ghost" ? "hover:bg-slate-100" : "bg-slate-900 text-white hover:bg-slate-800";
  return <button {...rest} className={`${base} ${styles} ${rest.className||""}`}>{children}</button>;
}
function Switch({checked, onChange}: {checked: boolean, onChange: (v:boolean)=>void}){
  return (<button onClick={()=>onChange(!checked)} className={"inline-flex h-6 w-11 items-center rounded-full border " + (checked ? "bg-slate-900":"bg-white")}><span className={"h-5 w-5 rounded-full bg-white border transition-transform " + (checked ? "translate-x-5":"translate-x-0")} /></button>)
}
function Tabs({value, onValueChange, children}:{value:string, onValueChange:(v:string)=>void, children:React.ReactNode}){ return <div data-tabs>{children}</div>; }
function TabsList({children}:{children:React.ReactNode}){ return <div className="inline-flex rounded-lg border bg-white">{children}</div>; }
function TabsTrigger({value, active, onClick, children}:{value:string, active?:boolean, onClick:()=>void, children:React.ReactNode}){ return <button onClick={onClick} className={"px-3 py-1.5 text-sm rounded-lg " + (active ? "bg-slate-900 text-white":"text-slate-700 hover:bg-slate-100")}>{children}</button>; }
function TabsContent({active, children}:{value:string, active:boolean, children:React.ReactNode}){ return active ? <div>{children}</div> : null; }

/* ------------------------------- currency utils ---------------------------- */
type CurrencyCode = "EUR" | "USD" | "GBP";
function currencySymbol(c: CurrencyCode) { return c === "USD" ? "$" : c === "GBP" ? "£" : "€"; }
function fmtCurrency(value: number, currency: CurrencyCode = "EUR"): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(isFinite(value) ? value : 0);
}
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

/* --------------------------------- engine --------------------------------- */
type ProjectionPoint = { month: number; label: string; nominal: number; real: number; };
function project({ currentFunds, targetGoal, years, monthlyContribution, contributionIncreasePct, annualReturnPct, annualInflationPct, }:
  { currentFunds:number; targetGoal:number; years:number; monthlyContribution:number; contributionIncreasePct:number; annualReturnPct:number; annualInflationPct:number; }):
  { points: ProjectionPoint[]; finalNominal: number; finalReal: number; hitMonth: number | null } {
  const months = Math.max(1, Math.round(years * 12));
  const mReturn = Math.pow(1 + annualReturnPct, 1 / 12) - 1;
  const mInfl = Math.pow(1 + annualInflationPct, 1 / 12) - 1;
  let balNom = currentFunds, balReal = currentFunds, contrib = monthlyContribution;
  const pts: ProjectionPoint[] = []; let hitMonth: number | null = null;
  for (let m = 1; m <= months; m++) {
    balNom += contrib; balReal += contrib;
    balNom *= 1 + mReturn; balReal = balReal * (1 + mReturn) / (1 + mInfl);
    if (m % 12 === 0) contrib *= 1 + contributionIncreasePct;
    const label = m % 12 === 0 ? `Y${Math.floor(m / 12)}` : ``;
    pts.push({ month: m, label, nominal: balNom, real: balReal });
    if (hitMonth === null && balNom >= targetGoal) hitMonth = m;
  }
  return { points: pts, finalNominal: balNom, finalReal: balReal, hitMonth };
}
function passiveIncomeTable(finalPot: number, rates: number[]) { return rates.map((r) => ({ rate: r, yearly: finalPot * r, monthly: (finalPot * r) / 12 })); }

/* ---------------------------- lifestyle + QoL UI --------------------------- */
function LifestylePanel({ displayFinal = 0, rates: ratesProp }: { displayFinal?: number; rates?: number[] }) {
  const defaultRates = [0.03, 0.035, 0.04, 0.05];
  const rates = (Array.isArray(ratesProp) && ratesProp.length > 0) ? ratesProp : defaultRates;

  // internal state as decimal (0.04 = 4%)
  const [selectedRate, setSelectedRate] = React.useState<number>(rates[2] ?? rates[rates.length - 1] ?? 0.04);
  const monthlyPassive = React.useMemo(() => (displayFinal * selectedRate) / 12, [displayFinal, selectedRate]);

  // === helpers (single definitions) ===
  const MAX_RATE_PCT = 100;
  const pctToDec = (pct: number) => pct / 100;
  const decToPct = (dec: number) => dec * 100;

  // parse + clamp helper (accepts commas too)
  const handleRateInput = (raw: string) => {
    const v = parseFloat(String(raw).replace(",", "."));
    if (Number.isNaN(v)) { setSelectedRate(0); return; }
    const clamped = Math.max(0, Math.min(MAX_RATE_PCT, v));
    setSelectedRate(pctToDec(clamped));
  };

  // % input with no native spinner, rounded display, and padding for the % suffix
  const PercentInput = ({
    valuePct,
    onChange,
  }: { valuePct: number; onChange: (v: string) => void }) => {
    const [val, setVal] = React.useState<string>("");

    // keep the field synced with parent (rounded to 1 decimal)
    React.useEffect(() => {
      const display = Number.isFinite(valuePct) ? valuePct.toFixed(1) : "";
      setVal(display);
    }, [valuePct]);

    return (
      <div className="relative">
        <input
          type="text"                // remove native spinner
          inputMode="decimal"        // mobile numeric keypad
          className="w-full rounded-md border px-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={val}
          onChange={(e) => {
            const s = e.target.value;
            setVal(s);
            onChange(s);             // lets parent parse/clamp
          }}
          onBlur={() => {
            const n = parseFloat(val.replace(",", "."));
            if (!Number.isNaN(n)) {
              const rounded = n.toFixed(1);
              setVal(rounded);
              onChange(rounded);
            }
          }}
          aria-label="Passive rate percent"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
      </div>
    );
  };

  type Band = { min: number; label: string; blurb: string };
  type CountryGuide = { name: string; currency: string; bands: Band[] };

  // --- country guides (unchanged) ---
  const guides: CountryGuide[] = [
    { name: "Mexico", currency: "€", bands: [
      { min: 0, label: "basic urban", blurb: "Careful budgeting in secondary cities." },
      { min: 3000, label: "comfortable", blurb: "Nice apartment, dining out often in major cities." },
      { min: 6000, label: "affluent", blurb: "High-end neighborhoods in CDMX/Monterrey; frequent travel." },
      { min: 8000, label: "luxury coastal/Polanco", blurb: "Premium areas on the coast or Polanco-level lifestyle." },
    ]},
    { name: "Portugal", currency: "€", bands: [
      { min: 0, label: "basic", blurb: "Modest life in smaller towns." },
      { min: 3000, label: "comfortable", blurb: "Good life in Lisbon/Porto; regular eating out & hobbies." },
      { min: 5000, label: "affluent", blurb: "Prime areas, private healthcare, frequent European trips." },
      { min: 8000, label: "luxury", blurb: "Top coastal spots (Cascais/Algarve), premium everything." },
    ]},
    { name: "Turkey", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Prudent spending in provincial cities." },
      { min: 2500, label: "comfortable", blurb: "Strong lifestyle in Izmir/Antalya; frequent dining out." },
      { min: 4500, label: "affluent", blurb: "Desirable Istanbul neighborhoods; private services." },
      { min: 7000, label: "luxury Bosphorus", blurb: "Premium coastal/central Istanbul living, travel often." },
    ]},
    { name: "Czechia", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Modest life; careful budgeting." },
      { min: 3000, label: "comfortable", blurb: "Karlín/Vinohrady vibe; fitness, cafes, short trips." },
      { min: 5000, label: "affluent", blurb: "Prime central living; premium groceries & hobbies." },
      { min: 8000, label: "luxury", blurb: "Top-tier apartment, frequent EU getaways, concierge vibe." },
    ]},
    { name: "Italy", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Smaller towns with prudent spending." },
      { min: 3500, label: "comfortable", blurb: "Good standard in Milan/Rome; regular aperitivi & travel." },
      { min: 6000, label: "affluent", blurb: "Prime zones, premium dining, domestic help." },
      { min: 9000, label: "luxury", blurb: "Top neighborhoods; frequent EU trips, high-end services." },
    ]},
    { name: "Spain", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Modest lifestyle in smaller cities." },
      { min: 3200, label: "comfortable", blurb: "Madrid/Barcelona good life; dining out & sports." },
      { min: 5500, label: "affluent", blurb: "Prime barrio; private healthcare, frequent travel." },
      { min: 8500, label: "luxury", blurb: "Top coastal/central addresses; premium everything." },
    ]},
    { name: "Thailand", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Simple life upcountry." },
      { min: 2500, label: "comfortable", blurb: "Very good life in Chiang Mai/Phuket." },
      { min: 4500, label: "affluent", blurb: "Premium Bangkok/Phuket lifestyle; frequent travel." },
      { min: 7000, label: "luxury", blurb: "High-end condo + concierge services, top dining." },
    ]},
    { name: "UK", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Tight budget in many areas." },
      { min: 5000, label: "comfortable", blurb: "Good standard outside Zone 1; regular trips." },
      { min: 8000, label: "affluent", blurb: "Prime London suburbs or strong central flat." },
      { min: 12000, label: "luxury", blurb: "Central London high-end lifestyle; frequent int'l travel." },
    ]},
    { name: "India", currency: "", bands: [
      { min: 0, label: "basic", blurb: "Lean lifestyle in Tier-2 cities." },
      { min: 2000, label: "comfortable", blurb: "Comfortable in Bangalore/Pune; frequent dining out." },
      { min: 4000, label: "affluent", blurb: "Premium neighborhoods in Mumbai/Delhi; domestic help." },
      { min: 7000, label: "luxury", blurb: "Top enclaves; business-class travel across India." },
    ]},
    { name: "Greece", currency: "€", bands: [
      { min: 0, label: "basic", blurb: "Modest life in mainland towns." },
      { min: 2800, label: "comfortable", blurb: "Athens/Thessaloniki with regular island trips." },
      { min: 5000, label: "affluent", blurb: "Prime Athens/Crete; private services." },
      { min: 8000, label: "luxury islands", blurb: "Santorini/Mykonos-level lifestyle in season." },
    ]},
    { name: "Brazil", currency: "€", bands: [
      { min: 0, label: "basic", blurb: "Careful budgeting in smaller cities." },
      { min: 2500, label: "comfortable", blurb: "Good life in Curitiba/Florianópolis; dining & sports." },
      { min: 4500, label: "affluent", blurb: "Premium areas in São Paulo/Rio; private healthcare." },
      { min: 8000, label: "luxury beachfront", blurb: "Ipanema/Leblon vibe; frequent domestic flights." },
    ]},
    { name: "Indonesia", currency: "€", bands: [
      { min: 0, label: "basic", blurb: "Simple life in secondary islands." },
      { min: 2000, label: "comfortable", blurb: "Very good life in Bali/Yogyakarta." },
      { min: 4000, label: "affluent", blurb: "Premium Bali/Central Jakarta lifestyle." },
      { min: 6500, label: "luxury", blurb: "Villa-level Bali; frequent regional travel." },
    ]},
  ];

  const chooseBand = (bands: Band[], income: number) => {
    const sorted = [...bands].sort((a, b) => a.min - b.min);
    return sorted.reduce((acc, b) => (income >= b.min ? b : acc), sorted[0]);
  };

  const travelBands: Band[] = [
    { min: 0, label: "lean nomad", blurb: "Slow travel in low-cost regions, hostels/guesthouses, economy flights a few times a year." },
    { min: 3000, label: "comfortable nomad", blurb: "1–2 months per location, decent apartments, weekly coworking, regional flights every 6–8 weeks." },
    { min: 6000, label: "premium nomad", blurb: "4★ hotels or upscale apartments, monthly intercontinental trips, occasional business-class upgrades." },
    { min: 10000, label: "luxury nomad", blurb: "5★ hotels/villas, frequent business class, guided experiences, concierge-style logistics." },
  ];
  const travelBand = chooseBand(travelBands, monthlyPassive);

  const [tab, setTab] = React.useState<"countries"|"itinerant">("countries");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border bg-white">
          <button className={`px-3 py-1.5 text-sm rounded-lg ${tab==='countries'?'bg-slate-900 text-white':'text-slate-700 hover:bg-slate-100'}`} onClick={()=>setTab('countries')}>Countries</button>
          <button className={`px-3 py-1.5 text-sm rounded-lg ${tab==='itinerant'?'bg-slate-900 text-white':'text-slate-700 hover:bg-slate-100'}`} onClick={()=>setTab('itinerant')}>Itinerant lifestyle</button>
        </div>
      </div>

      {tab==='countries' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">Passive rate</div>
              <PercentInput valuePct={decToPct(selectedRate)} onChange={handleRateInput} />
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">Monthly passive (approx)</div>
              <div className="text-lg font-semibold">{fmtCurrency(monthlyPassive)}</div>
              <div className="text-xs text-slate-500">Based on your projected pot × rate</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">How to read</div>
              <div className="text-sm text-slate-600">Labels are directional, not promises. 1 = basic • 2 = comfortable • 3 = affluent • 4 = luxury</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
            {guides.map(g => {
              const band = chooseBand(g.bands, monthlyPassive);
              return (
                <div key={g.name} className="p-4 rounded-xl border bg-white">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium">{g.name}</div>
                    <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5">{band.label}</span>
                  </div>
                  <div className="text-sm text-slate-600">{band.blurb}</div>
                  <div className="mt-2 text-xs text-slate-500">Income considered: {fmtCurrency(monthlyPassive)} / mo</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==='itinerant' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">Passive rate</div>
              <PercentInput valuePct={decToPct(selectedRate)} onChange={handleRateInput} />
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">Monthly passive (approx)</div>
              <div className="text-lg font-semibold">{fmtCurrency(monthlyPassive)}</div>
              <div className="text-xs text-slate-500">Projected pot × rate</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border">
              <div className="text-xs uppercase text-slate-500">Travel tier</div>
              <div className="text-sm text-slate-600">{travelBand.label}</div>
            </div>
          </div>

          <div className="mt-3 p-4 rounded-xl border bg-white">
            <div className="text-sm font-medium mb-1">What this buys, roughly</div>
            <div className="text-sm text-slate-600">{travelBand.blurb}</div>
            <div className="text-xs text-slate-500 mt-2">Directional only; trip style, seasonality, and fx rates move the needle a lot.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- App ----------------------------------- */
export default function App() {
  const [currentFunds, setCurrentFunds] = useState(100000);
  const [targetGoal, setTargetGoal] = useState(1000000);
  const [years, setYears] = useState(10);
  const [monthlyContribution, setMonthlyContribution] = useState(1500);
  const [contributionIncreasePct, setContributionIncreasePct] = useState(5);
  const [annualReturnPct, setAnnualReturnPct] = useState(6);
  const [annualInflationPct, setAnnualInflationPct] = useState(2);
  const [showReal, setShowReal] = useState(true);
  const [rates, setRates] = useState<number[]>([0.03, 0.035, 0.04, 0.05]);

  // currency preference (persist to localStorage)
  const [currency, setCurrency] = useState<CurrencyCode>(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("currency") as CurrencyCode | null) : null;
    return saved || "EUR";
  });
  useEffect(() => { try { localStorage.setItem("currency", currency); } catch {} }, [currency]);

  const { points, finalNominal, finalReal, hitMonth } = useMemo(()=>project({
      currentFunds, targetGoal, years, monthlyContribution,
      contributionIncreasePct: contributionIncreasePct / 100,
      annualReturnPct: annualReturnPct / 100,
      annualInflationPct: annualInflationPct / 100,
    }),[currentFunds, targetGoal, years, monthlyContribution, contributionIncreasePct, annualReturnPct, annualInflationPct]);

  const durationYears = (points.length || 0) / 12;
  const hitYears = hitMonth ? (hitMonth / 12).toFixed(1) : null;
  const displayFinal = showReal ? finalReal : finalNominal;

  const passive = useMemo(() => passiveIncomeTable(displayFinal, rates), [displayFinal, rates]);

  const addRate = () => {
    const last = rates[rates.length - 1] ?? 0.04;
    const next = Math.round((last + 0.005) * 1000) / 1000;
    setRates(Array.from(new Set([...rates, next])));
  };
  const resetRates = () => setRates([0.03, 0.035, 0.04, 0.05]);

  const exportCSV = () => {
    const header = ["Month", "Label", `Nominal_${currency}`, `Real_${currency}`].join(",");
    const rows = points.map((p) => [p.month, p.label, Math.round(p.nominal), Math.round(p.real)].join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fire_projection.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const [outTab, setOutTab] = useState<"passive"|"details">("passive");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
    <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
  <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 md:py-4">
    {/* On phones: grid stack. On md+: flex row */}
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:flex md:items-center md:justify-between">
      
      {/* Left: logo + title */}
      <div className="col-span-2 md:col-span-1 flex items-center gap-2 sm:gap-3">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-slate-900/90 text-white grid place-items-center font-bold shrink-0">
          {currencySymbol(currency)}
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl md:text-2xl font-semibold tracking-tight">
            Easy FIRE Planner <span className="opacity-60">— Free</span>
          </h1>
          <p className="hidden sm:block text-xs sm:text-sm text-slate-500">
            Financial Independence, Retire Early made easy.
          </p>
        </div>
      </div>

      {/* Middle: currency + real/nominal toggle */}
      <div className="col-span-1 flex items-center justify-start gap-2 sm:gap-3 md:order-none">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <label className="text-xs sm:text-sm text-slate-600">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="rounded-md border px-2 py-1 text-sm"
            aria-label="Select currency"
          >
            <option value="EUR">€ EUR</option>
            <option value="USD">$ USD</option>
            <option value="GBP">£ GBP</option>
          </select>
        </div>

    {/* Real / Nominal toggle */}
<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
  <div
    className="inline-flex rounded-md shadow-sm overflow-hidden"
    role="group"
    aria-label="Choose between inflation-adjusted (real) or raw (nominal) currency"
  >
    <button
      type="button"
      onClick={() => setShowReal(true)}
      className={`px-3 py-1 text-xs sm:text-sm font-medium border border-gray-300 ${
        showReal ? "bg-slate-900 text-white" : "bg-white text-gray-700"
      } rounded-l-md`}
    >
      Real
    </button>
    <button
      type="button"
      onClick={() => setShowReal(false)}
      className={`px-3 py-1 text-xs sm:text-sm font-medium border border-gray-300 ${
        !showReal ? "bg-slate-900 text-white" : "bg-white text-gray-700"
      } rounded-r-md`}
    >
      Nominal
    </button>
  </div>

  {/* helper – visible on phones only */}
  <p className="text-[10px] leading-3 text-gray-500 sm:hidden m-0">
    Real = inflation-adjusted; Nominal = not adjusted.
  </p>
</div>

        {/* Right: Export button (icon-only on phones) */}
      <div className="col-span-1 md:col-auto flex items-center justify-end gap-2">
        {/* icon-only on xs */}
        <Button
          variant="secondary"
          onClick={exportCSV}
          className="px-2 py-2 inline-flex sm:hidden"
          aria-label="Export CSV"
          title="Export CSV"
        >
          <Download className="w-4 h-4" />
        </Button>

        {/* text button from sm+ */}
        <Button
          variant="secondary"
          onClick={exportCSV}
          className="gap-2 hidden sm:inline-flex"
          title="Download the month-by-month projection to CSV."
        >
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>
    </div>
  </div>
</header>

      <main className="max-w-6xl mx-auto p-4 grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Inputs</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div title="How much you already have invested/liquid towards FIRE.">
                <Label>Current funds</Label>
                <Input type="number" value={currentFunds} onChange={(e)=>setCurrentFunds(Number(e.target.value))} min={0} />
              </div>
              <div title="Your target portfolio size to become financially independent.">
                <Label>Target goal ({currency})</Label>
                <Input type="number" value={targetGoal} onChange={(e)=>setTargetGoal(Number(e.target.value))} min={0} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div title="How many years you want to project forward.">
                <Label>Years to project</Label>
                <Input type="number" value={years} onChange={(e)=>setYears(Number(e.target.value))} min={1} />
              </div>
              <div title="How much you invest each month (before any annual step-ups).">
                <Label>Monthly contribution</Label>
                <Input type="number" value={monthlyContribution} onChange={(e)=>setMonthlyContribution(Number(e.target.value))} min={0} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div title="Automatic raise to your monthly contribution once per year.">
                <Label>Annual increase in contribution (%)</Label>
                <Input type="number" value={contributionIncreasePct} onChange={(e)=>setContributionIncreasePct(Number(e.target.value))} min={0} step={0.5} />
              </div>
              <div title="Expected average annual return during accumulation (before fees/taxes).">
                <Label>Expected annual return (%)</Label>
                <Input type="number" value={annualReturnPct} onChange={(e)=>setAnnualReturnPct(Number(e.target.value))} step={0.1} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div title="Assumed average annual inflation. Real view subtracts this from growth.">
                <Label>Assumed annual inflation (%)</Label>
                <Input type="number" value={annualInflationPct} onChange={(e)=>setAnnualInflationPct(Number(e.target.value))} step={0.1} />
              </div>
              <div className="text-sm text-slate-500 flex items-center">
                Real view discounts inflation continuously; nominal view shows raw values.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border" title="Projected portfolio size at the end of the horizon under your assumptions.">
                <div className="text-xs uppercase tracking-wide text-slate-500">Projected final pot ({showReal ? "real" : "nominal"})</div>
                <div className="text-2xl font-semibold">{fmtCurrency(displayFinal, currency)}</div>
                <div className="text-xs text-slate-500">over {durationYears.toFixed(1)} years</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border" title="Your target. The dashed line in the chart marks it (inflation-adjusted in real view).">
                <div className="text-xs uppercase tracking-wide text-slate-500">Target goal</div>
                <div className="text-2xl font-semibold">{fmtCurrency(targetGoal, currency)}</div>
                <div className="text-xs text-slate-500">{hitYears ? `Hit in ~${hitYears} years` : "Not reached in horizon"}</div>
              </div>
            </div>

            <div className="h-64 md:h-72 rounded-xl border" title="Timeline of your portfolio growth.">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={points.map((p, i) => ({ idx: i + 1, label: p.label || `M${p.month}`, value: showReal ? p.real : p.nominal }))}
                  margin={{ left: 12, right: 12, top: 16, bottom: 8 }}
                >
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopOpacity={0.35} /><stop offset="100%" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" hide interval={11} />
                  <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={50} />
                  <RechartsTooltip content={<ChartTooltip currency={currency} />} />
                  <ReferenceLine y={showReal ? targetGoal / Math.pow(1 + (annualInflationPct / 100), years) : targetGoal} strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="value" fill="url(#g)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div className="inline-flex rounded-lg border bg-white">
                <button className={`px-3 py-1.5 text-sm rounded-lg ${outTab==='passive'?'bg-slate-900 text-white':'text-slate-700 hover:bg-slate-100'}`} onClick={()=>setOutTab('passive')}>Passive income</button>
                <button className={`px-3 py-1.5 text-sm rounded-lg ${outTab==='details'?'bg-slate-900 text-white':'text-slate-700 hover:bg-slate-100'}`} onClick={()=>setOutTab('details')}>Details</button>
              </div>

              {outTab==='passive' && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm text-slate-600">On your projected pot ({showReal ? "real" : "nominal"}):</div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={addRate} title="Add another withdrawal/yield rate tile">Add rate</Button>
                      <Button variant="ghost" onClick={resetRates} className="gap-2" title="Restore default rates"><RefreshCcw className="w-4 h-4"/>Reset</Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {passive.map((row) => (
                      <div key={row.rate} className="p-4 rounded-xl border" title="Estimated income if you withdrew/earned at this annual rate.">
                        <div className="text-xs text-slate-500">{(row.rate * 100).toFixed(1)}% rate</div>
                        <div className="text-lg font-semibold">
                          {fmtCurrency(row.yearly, currency)}<span className="text-xs text-slate-500">/yr</span>
                        </div>
                        <div className="text-sm text-slate-500">{fmtCurrency(row.monthly, currency)}/mo</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Interpret rates either as a yield (e.g., bond/dividend) or a withdrawal rate (e.g., 3.5% SWR).
                    This tool does not model taxes or fees.
                  </div>
                </div>
              )}

              {outTab==='details' && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl bg-slate-50 border">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Final nominal</div>
                    <div className="font-semibold">{fmtCurrency(finalNominal, currency)}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Final real</div>
                    <div className="font-semibold">{fmtCurrency(finalReal, currency)}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border" title="Equivalent average monthly return under your annual assumption.">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Monthly return (nominal)</div>
                    <div className="font-semibold">{fmtPct(Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1)}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border" title="Equivalent average monthly inflation under your assumption.">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Monthly inflation</div>
                    <div className="font-semibold">{fmtPct(Math.pow(1 + annualInflationPct / 100, 1 / 12) - 1)}</div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 rounded-2xl shadow-sm">
          <CardHeader><CardTitle>What-if & Lifestyle</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border">
                <div className="text-sm font-medium">When do I hit my target?</div>
                <div className="text-xs text-slate-500 mb-2">Based on your inputs.</div>
                <div className="text-xl font-semibold">{hitYears ? `~${hitYears} years` : "Beyond horizon"}</div>
              </div>
              <ContributionSolver
                currentFunds={currentFunds} targetGoal={targetGoal} years={years}
                contributionIncreasePct={contributionIncreasePct / 100} annualReturnPct={annualReturnPct / 100}
                currency={currency}
              />
              <TargetSolver
                currentFunds={currentFunds} years={years} monthlyContribution={monthlyContribution}
                contributionIncreasePct={contributionIncreasePct / 100} annualReturnPct={annualReturnPct / 100}
                currency={currency}
              />
            </div>

            <LifestylePanel displayFinal={displayFinal} rates={rates} currency={currency} />
          </CardContent>
        </Card>
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-8 text-xs text-slate-500">
        Built for thoughtful planning. Assumptions are for illustration only and not financial advice.
      </footer>
    </div>
  );
}

/* ------------------------------- Solvers & UX ------------------------------ */
function ContributionSolver({
  currentFunds, targetGoal, years, contributionIncreasePct, annualReturnPct, currency,
}:{ currentFunds:number; targetGoal:number; years:number; contributionIncreasePct:number; annualReturnPct:number; currency: CurrencyCode; }) {
  const [solved, setSolved] = useState<number | null>(null); const [busy, setBusy] = useState(false);
  const solve = () => {
    setBusy(true);
    let lo = 0, hi = 100000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const { finalNominal } = project({ currentFunds, targetGoal, years, monthlyContribution: mid, contributionIncreasePct, annualReturnPct, annualInflationPct: 0, });
      if (finalNominal >= targetGoal) hi = mid; else lo = mid;
    }
    setSolved(hi); setBusy(false);
  };
  return (
    <div className="p-4 rounded-xl border">
      <div className="text-sm font-medium">Monthly needed to hit target</div>
      <div className="text-xs text-slate-500 mb-2">Solves for contribution with your return & step-up assumptions.</div>
      <div className="text-xl font-semibold">{solved !== null ? fmtCurrency(solved, currency) : "—"}</div>
      <button className="px-3 py-2 rounded-md bg-slate-900 text-white mt-3 w-full gap-2" onClick={solve} disabled={busy}>Solve</button>
    </div>
  );
}

function TargetSolver({
  currentFunds, years, monthlyContribution, contributionIncreasePct, annualReturnPct, currency,
}:{ currentFunds:number; years:number; monthlyContribution:number; contributionIncreasePct:number; annualReturnPct:number; currency: CurrencyCode; }) {
  const [solved, setSolved] = useState<number | null>(null); const [busy, setBusy] = useState(false);
  const solve = () => {
    setBusy(true);
    const { finalNominal } = project({ currentFunds, targetGoal: Infinity, years, monthlyContribution, contributionIncreasePct, annualReturnPct, annualInflationPct: 0, });
    setSolved(finalNominal); setBusy(false);
  };
  return (
    <div className="p-4 rounded-xl border">
      <div className="text-sm font-medium">Pot you can reach</div>
      <div className="text-xs text-slate-500 mb-2">Given your years, contribution, and return assumptions.</div>
      <div className="text-xl font-semibold">{solved !== null ? fmtCurrency(solved, currency) : "—"}</div>
      <button className="px-3 py-2 rounded-md bg-slate-900 text-white mt-3 w-full gap-2" onClick={solve} disabled={busy}>Solve</button>
    </div>
  );
}

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border bg-white/90 backdrop-blur px-3 py-2 shadow-sm">
      <div className="text-xs text-slate-500">{label || "Month"}</div>
      <div className="text-sm font-semibold">{fmtCurrency(Number(v), currency)}</div>
    </div>
  );
}
