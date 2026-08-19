import { connection } from "next/server";

export default async function PatreonLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Access is cookie-backed and must always be evaluated for this request.
  await connection();
  return children;
}
