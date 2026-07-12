export default function RepositoriesLoading() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header>
          <h1 className="text-balance text-2xl font-semibold">Repositories</h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Choose a repository context for Sessions, Automations, and Runs.
          </p>
        </header>
        <div aria-label="Loading repositories" className="grid gap-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              data-repository-skeleton
              className="h-24 animate-pulse rounded-md border border-border bg-muted/30 motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
