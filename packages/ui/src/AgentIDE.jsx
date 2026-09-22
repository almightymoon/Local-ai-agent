import React, { useEffect, useState } from "react";
import { Icon } from "./icons";

export default function AgentIDE() {
  const [installed, setInstalled] = useState(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { window.desktop?.ideStatus?.().then(value => setInstalled(value.installed)).catch(error => setNotice(error.message)); }, []);
  async function open(chooseFolder = false) {
    setOpening(true); setNotice("");
    try {
      const result = await window.desktop.openIde(chooseFolder);
      if (result.opened) setNotice(`Opened ${result.workspace}. Select the Zentra icon in the IDE to start coding.`);
    } catch (error) { setNotice(error.message); }
    finally { setOpening(false); }
  }
  return <div className="ide-page">
    <div className="ide-hero">
      <span className="ide-badge"><Icon name="code" size={15} /> POWERED BY VSCODIUM</span>
      <h2>From a conversation<br />to working code.</h2>
      <p>A full open-source IDE, connected to your local AI. Explore your project, ask for a change, review the diff, and let Zentra run the checks.</p>
      <div className="ide-launch">
        {window.desktop?.openIde ? <><button className="primary" disabled={opening} onClick={() => open()}><Icon name="code" size={17} /> {opening ? "Opening IDE…" : "Open Agent IDE"}</button><button className="secondary" disabled={opening} onClick={() => open(true)}>Choose project folder</button></> : <div className="ide-browser-note">Open the desktop app to launch the IDE, or run <code>npm run start:ide</code> from the Zentra folder.</div>}
      </div>
      {installed === false && <p>One-time setup: <code>npm run setup:ide</code></p>}
      {notice && <p role="status" className="ide-notice">{notice}</p>}
    </div>
    <div className="ide-features">
      {[['code', 'A real coding workspace', 'Files, syntax highlighting, source control, extensions, and a terminal — all in VSCodium.'], ['chat', 'Your model, in the editor', 'Ask, Plan, or Agent mode. Add a code selection, or let Zentra inspect the open project.'], ['check', 'Review, apply, continue', 'Compare proposed edits in a native diff. Approve an action and the agent continues the task.']].map(([icon, title, detail]) => <article key={title}><Icon name={icon} size={21} /><h3>{title}</h3><p>{detail}</p></article>)}
    </div>
    <div className="ide-how"><h3>Your first task</h3><ol><li>Open the IDE and trust your project folder.</li><li>Select the Zentra icon, or press <kbd>⌘ / Ctrl + Shift + L</kbd>.</li><li>Ask: “Inspect this project, improve one feature, and run the relevant tests.”</li><li>Review each proposed change. Command results appear in <strong>Zentra Agent</strong> output.</li></ol><p>The IDE opens in its own window with a separate profile. Your configured local model must be running. Commands execute with your user permissions after approval.</p></div>
  </div>;
}
