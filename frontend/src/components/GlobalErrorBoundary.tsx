// @ts-nocheck
import React from "react";

export default class GlobalErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, info: any) {
    try {
      console.error("[FlixIT] render crash recovered", error, info);
    } catch {}
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#141414",
          color: "#fff",
          fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <section style={{ width: "min(560px, 100%)", textAlign: "center" }}>
          <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 10 }}>FLIX·IT</div>
          <div style={{ color: "rgba(255,255,255,.74)", fontSize: 16, lineHeight: 1.5, marginBottom: 24 }}>
            La pagina ha avuto un problema temporaneo. Puoi riprovare senza restare bloccato su una schermata vuota.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 0,
                borderRadius: 7,
                padding: "11px 20px",
                background: "#fff",
                color: "#111",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Riprova
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/browse")}
              style={{
                border: "1px solid rgba(255,255,255,.35)",
                borderRadius: 7,
                padding: "11px 20px",
                background: "rgba(255,255,255,.12)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Torna alla Home
            </button>
          </div>
        </section>
      </main>
    );
  }
}
