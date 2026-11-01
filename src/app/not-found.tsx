import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-6xl font-extrabold text-brand">404</p>
      <h1 className="mt-4 text-xl font-bold">Aradığınız sayfa bulunamadı</h1>
      <Link href="/" className="btn btn-primary mt-8">Ana sayfaya dön</Link>
    </div>
  );
}
