import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Klai — Support & Assistance',
  description:
    'Help, usage guide, and support for the Klai browser extension — the interface that generates itself over any video.',
}

const SUPPORT_EMAIL = 'support@klai.pro'

const sectionStyle: React.CSSProperties = {
  marginBottom: 40,
}

const h2Style: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: '0 0 12px',
  color: '#0a0a0e',
}

const pStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.7,
  color: '#3f3f46',
  margin: '0 0 12px',
}

const liStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.7,
  color: '#3f3f46',
  marginBottom: 8,
}

export default function AssistPage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '64px 24px 96px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <header style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: '0 0 8px', color: '#0a0a0e' }}>
          Klai — Support &amp; Assistance
        </h1>
        <p style={{ fontSize: 18, color: '#71717a', margin: 0 }}>
          The interface that generates itself over any video.
        </p>
      </header>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What is Klai?</h2>
        <p style={pStyle}>
          Klai is a browser extension that turns any video into an interactive
          surface. You ask a question by voice or text, and Klai generates the
          widget you need — a live scoreboard, stats, a timer, win probability,
          key points, a definition, and more — composed right over the video you
          are watching. It works on sports, lectures, cooking videos, gameplay,
          and any other content.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>How to use it</h2>
        <ol style={{ paddingLeft: 22, margin: 0 }}>
          <li style={liStyle}>Open any page that has a video.</li>
          <li style={liStyle}>Click the Klai icon in your browser toolbar.</li>
          <li style={liStyle}>
            Speak or type what you want — for example, &quot;who is winning?&quot;,
            &quot;show me the stats&quot;, or &quot;summarize this&quot;.
          </li>
          <li style={liStyle}>
            Klai reads the current video frame for context and renders the matching
            widget over the video.
          </li>
          <li style={liStyle}>
            Turn on <strong>Watch mode</strong> to let Klai surface notable moments
            on its own.
          </li>
        </ol>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Troubleshooting</h2>
        <ul style={{ paddingLeft: 22, margin: 0 }}>
          <li style={liStyle}>
            <strong>Nothing appears over the video:</strong> make sure the page
            actually contains a video element, and reload the tab after installing
            or updating the extension.
          </li>
          <li style={liStyle}>
            <strong>Voice does not work:</strong> your browser may not support the
            Web Speech API, or microphone access was denied. You can always type
            your request instead.
          </li>
          <li style={liStyle}>
            <strong>The widget shows the wrong information:</strong> Klai reads the
            on-screen graphics, which can be ambiguous on cluttered broadcasts. Try
            rephrasing your request or asking again.
          </li>
          <li style={liStyle}>
            <strong>It does not work on certain pages:</strong> browser-protected
            pages (such as the extensions page or the new-tab page) do not allow
            extensions to run.
          </li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Permissions &amp; privacy</h2>
        <p style={pStyle}>
          Klai requests access to the active tab so it can display widgets on the
          video you are watching, and it captures the currently visible tab frame
          so the AI can understand the on-screen context and answer your request.
          Capture only happens when you submit a request or enable Watch mode.
        </p>
        <p style={pStyle}>
          Klai does not sell your data and does not collect personal browsing
          history. Captured frames are sent only to the Klai service to process
          your request and generate the response.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Contact support</h2>
        <p style={pStyle}>
          Need help or want to report an issue? Reach us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2563eb', fontWeight: 600 }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </main>
  )
}
