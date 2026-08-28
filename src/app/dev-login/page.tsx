"use client";
import { useState } from "react";

/** DEV-LOGIN — ver src/app/api/dev-login/route.ts para o contrato de segurança. */
export default function DevLoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Falha no login");
      return;
    }
    const { role } = await res.json();
    window.location.href = role === "DOCTOR" ? "/medico/fila" : role === "PATIENT" ? "/paciente/dashboard" : "/";
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1>Renovamed — Dev Login</h1>
      <p style={{ fontSize: 12, color: "#a00" }}>
        Mecanismo de desenvolvimento — substitui o Supabase Auth real, ainda não integrado (ver docs/PENDENCIAS.md).
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="e-mail do usuário de teste"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button type="submit" style={{ width: "100%", padding: 8 }}>
          Entrar
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
