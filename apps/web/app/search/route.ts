import { domain } from "@datadeal/contracts";

export function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = domain.safeParse(url.searchParams.get("domain"));
  if (!parsed.success)
    return new Response("Enter a public domain, such as example.com.", {
      status: 400,
    });
  return Response.redirect(new URL("/report/" + parsed.data, url), 303);
}
