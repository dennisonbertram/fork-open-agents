import { prepareManagedRuntimeDemo } from "@/lib/dev/managed-runtime-demo";
import { isTestAuthEnabled, setTestAuthCookie } from "@/lib/session/test-auth";

export async function GET() {
  if (!isTestAuthEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const demo = await prepareManagedRuntimeDemo();
    const response = Response.json(demo);
    setTestAuthCookie(response);
    return response;
  } catch (error) {
    console.error("Failed to prepare managed runtime demo:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare managed runtime demo",
      },
      { status: 500 },
    );
  }
}
