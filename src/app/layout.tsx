export const metadata = {
  title: "Renovamed",
  description: "Fatia 1 — Fundação (build mínimo para validação de pipeline)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
