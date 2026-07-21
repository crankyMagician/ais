export const metadata = { title: "Why ships go dark · AIS Dark Tracker" };

export default function WhyPage() {
  return (
    <main className="page">
      <h1>Why ships go dark</h1>
      <p>
        AIS (the Automatic Identification System) is a VHF transponder system
        that broadcasts a ship&apos;s identity, position, course and speed.
        Under SOLAS chapter V, regulation 19, it is mandatory for ships of 300
        gross tonnage and up on international voyages, cargo ships of 500 GT
        and up, and all passenger ships. When a vessel that has been
        transmitting steadily disappears from AIS, something happened. Often
        it is mundane. Sometimes it is not. This page lists the documented
        reasons, roughly from most to least benign.
      </p>

      <h2>Reception gaps, not transmission gaps</h2>
      <p>
        The most common reason a vessel vanishes from a tracking site is that
        nobody heard it, not that it stopped talking. Terrestrial AIS
        receivers reach roughly 40 to 60 nautical miles offshore; beyond that
        only satellites listen, and free data feeds (including ours) are
        terrestrial. A ship sailing over the horizon from the receiver network
        goes dark on the map while transmitting the whole time. This is why
        the detector on this site models its own coverage and discounts
        disappearances near the edge of it.
      </p>

      <h2>Equipment failure and port operations</h2>
      <p>
        Transponders break, antennas corrode, power gets cycled during
        maintenance. Ships at berth also frequently power down electronics.
        Disappearances that begin moored in a port area are tagged
        &quot;in-port&quot; here and are rarely interesting.
      </p>

      <h2>Security: the legal off switch</h2>
      <p>
        SOLAS V/19 itself allows the master to switch AIS off where its
        operation might compromise the safety or security of the ship, with
        the expectation that it is restarted once the danger passes. This is
        standard practice in piracy high-risk areas such as the Gulf of
        Guinea and, historically, the western Indian Ocean, and industry
        guidance (BMP5) describes when masters may do it. During the Red Sea
        attacks that began in 2023, many merchant ships either went dark or
        broadcast defensive AIS destination messages while transiting.
      </p>

      <h2>Sanctions evasion and the shadow fleet</h2>
      <p>
        Since the G7 price cap on Russian oil took effect in December 2022, a
        large secondhand tanker fleet, commonly called the shadow or dark
        fleet, has moved Russian, Iranian and Venezuelan crude outside
        mainstream insurance and finance. Going dark around loadings,
        ship-to-ship transfers and terminal calls is a signature behavior,
        alongside flag hopping and outright position spoofing. Documented
        hot spots include the Gulf of Finland and Baltic transit lanes, the
        Black Sea, the Laconian Gulf off Greece (a ship-to-ship transfer
        anchorage), and the waters off Malaysia and the UAE. The KSE
        Institute, Kyiv School of Economics, publishes ongoing shadow-fleet
        tracking; the Atlantic Council and S&amp;P Global have documented the
        fleet&apos;s growth; the UN Panel of Experts on North Korea has for
        years documented dark ship-to-ship transfers of coal and oil as a
        core DPRK sanctions-evasion technique.
      </p>

      <h2>Illegal, unreported and unregulated fishing</h2>
      <p>
        Global Fishing Watch researchers (Welch et al., Science Advances,
        2022) estimated that intentional AIS disabling obscures roughly 6
        percent of global fishing vessel activity, concentrated near the
        edges of exclusive economic zones and in contested waters off
        Argentina, West Africa and the northwest Pacific. Disabling near an
        EEZ boundary is a classic pattern: fish inside, transmit outside.
      </p>

      <h2>Smuggling</h2>
      <p>
        Narcotics, fuel and arms smuggling all correlate with AIS gaps,
        typically combined with night movements and rendezvous behavior.
        Interdiction cases regularly cite AIS gaps as initial cause for
        suspicion.
      </p>

      <h2>Spoofing is not the same as silence</h2>
      <p>
        A related but distinct behavior is broadcasting false positions,
        which looks like the opposite of going dark: the vessel is loud but
        lying. GPS interference around conflict zones (well documented in the
        eastern Baltic and Black Sea since 2022) can also scatter honest
        vessels&apos; reported positions. This site flags physically
        impossible reappearance jumps, which can indicate either a long dark
        transit or spoofing on one side of the gap.
      </p>

      <h2>Methodology and honest limits</h2>
      <p>
        The pipeline behind this site collects for about ten minutes every
        twenty minutes from two sources: aisstream.io&apos;s global
        crowdsourced terrestrial feed (whole-world subscription) and the
        Norwegian Coastal Administration&apos;s open feed for the Norwegian
        coast. Every received vessel appears on the map&apos;s snapshot
        layer, but dark events are only opened inside seven watch regions
        where coverage is dense enough to make absence meaningful: the
        Baltic, the Norwegian coast, the Black Sea, the Eastern
        Mediterranean, the Persian Gulf, the Gulf of Guinea, and the South
        China Sea. An event opens only when a consistently observed vessel
        stops reporting for more than 90 effective minutes from a
        well-covered cell, away from region boundaries, after dead reckoning
        says it could not simply have sailed out. Time when our own collector
        was down or a source was degraded never counts against a vessel, and
        mass disappearances are treated as receiver outages.
      </p>
      <p>
        Even so: a classification of &quot;possibly deliberate&quot; is an
        inference from reception patterns, never proof. We cannot see
        satellite AIS, we cannot distinguish a switched-off transponder from
        a broken one, and coverage from community receivers shifts from day
        to day. Treat every event here as a starting point for questions,
        not a conclusion.
      </p>

      <h2>Sources</h2>
      <ul>
        <li>
          <a href="https://www.imo.org/en/OurWork/Safety/Pages/AIS.aspx">
            IMO, AIS carriage requirements (SOLAS V/19)
          </a>
        </li>
        <li>
          <a href="https://www.science.org/doi/10.1126/sciadv.abq2109">
            Welch et al., Hot spots of unseen fishing vessels, Science
            Advances (2022)
          </a>
          , with{" "}
          <a href="https://globalfishingwatch.org/">Global Fishing Watch</a>
        </li>
        <li>
          <a href="https://kse.ua/kse-institute/">
            KSE Institute, Russian oil tracker and shadow-fleet reporting
          </a>
        </li>
        <li>
          <a href="https://www.atlanticcouncil.org/">
            Atlantic Council, shadow-fleet analyses
          </a>
        </li>
        <li>
          <a href="https://www.un.org/securitycouncil/sanctions/1718/panel_experts/reports">
            UN Panel of Experts on the DPRK, ship-to-ship transfer reports
          </a>
        </li>
        <li>
          <a href="https://www.maritimeglobalsecurity.org/risksissues/piracy/">
            BMP5, industry best management practices for piracy high-risk
            areas
          </a>
        </li>
      </ul>
    </main>
  );
}
