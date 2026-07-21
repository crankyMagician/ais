import DarkDashboard from "@/components/DarkDashboard";

export const metadata = { title: "Dark events · AIS Dark Tracker" };

export default function DarkPage() {
  return (
    <main className="page">
      <h1>Dark events</h1>
      <p className="muted">
        Vessels in the watch regions that stopped transmitting AIS while under
        observation. Classifications are inference from reception patterns, not
        proof of intent; see the{" "}
        <a href="../why/">methodology notes</a>.
      </p>
      <DarkDashboard />
    </main>
  );
}
