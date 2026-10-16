import { listCities } from "@/lib/data/cities";
import Planner from "./planner";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Gezinti</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Şehri, bütçeni ve ulaşım tercihini seç; gezilecek yerleri, yemekleri ve
          rotayı ajanlar planlasın.
        </p>
      </header>
      <Planner cities={listCities()} />
    </main>
  );
}
