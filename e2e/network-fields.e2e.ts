import { chromium, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { observeConsentWithCoverage } from "../apps/worker/consent-observation";

test("records only bounded outgoing request categories and matched responses on synthetic browser visits", async () => {
  const browser = await chromium.launch({
    args: ["--no-proxy-server", "--host-resolver-rules=MAP * 127.0.0.1"],
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://www.example.org");
    if (url.pathname === "/aborted") {
      req.socket.destroy();
      return;
    }
    if (url.pathname === "/frame") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<script>fetch("/in-frame",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({screen_width:1200})})</script>',
      );
      return;
    }
    if (url.pathname !== "/") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end("response-only-address@example.net");
      return;
    }
    const port = server.address();
    if (!port || typeof port === "string") throw Error("Missing test port");
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><body>
      <div id="dialog" role="dialog"><button onclick="choice(false)">Accept only essential cookies</button><button onclick="choice(true)">Accept all</button></div>
      <iframe src="/frame"></iframe>
      <script>
      const post=(url,type,body)=>fetch(url,{method:"POST",headers:{"Content-Type":type},body});
      const json=(url,body)=>post(url,"application/json",JSON.stringify(body));
      json("/api/event",{name:"pageview",url:location.href,domain:location.hostname,props:{odd:{other:"json-secret@example.net"}}});
      post("http://stats.example.org:${port.port}/api/event","text/plain",JSON.stringify({n:"pageview",u:location.href,d:"www.example.org",r:"",w:1234}));
      post("/form","application/x-www-form-urlencoded","unrecognized_name=form-secret%40example.net&email=redacted");
      post("/body","text/plain","A synthetic address: text-secret@example.net.");
      post("/nonsignal","text/plain","https://example.org/a@b.example and top-level.example");
      json("/generic-event",{name:"pageview",url:location.href,domain:location.hostname});
      json("/api/event",{name:"pageview",url:"https://unrelated.invalid",domain:"unrelated.invalid"});
      fetch("http://api.example.net:${port.port}/aborted?visitor_id=arbitrary-private-id").catch(()=>{});
      setTimeout(()=>fetch("/pixel?unknown=query-secret%40example.net"),1250);
      fetch("/email-only-in-response");
      post("/oversize","text/plain","X".repeat(27000));
      function choice(accepted){document.querySelector("#dialog").remove();if(accepted)fetch("/ad?gclid=sample-click-secret");}
      </script></body></html>`);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing test port");
    const result = await observeConsentWithCoverage(
      browser,
      new URL("http://www.example.org:" + address.port),
    );
    expect(result.coverage).toEqual({
      default: "measured",
      rejected: "measured",
      accepted: "measured",
    });
    const [initial, rejected, accepted] = result.observations;
    const signatures = initial.network.filter((row) => row.signature);
    expect(signatures).toHaveLength(2);
    expect(signatures).toContainEqual(
      expect.objectContaining({
        targetDomain: "example.org",
        scheme: "http",
        relation: "same_origin",
        attempts: 1,
        responses: 1,
        fieldCategories: [
          "custom_properties",
          "email_value",
          "event_name",
          "page_url",
          "site_domain",
        ],
      }),
    );
    expect(signatures).toContainEqual(
      expect.objectContaining({
        targetDomain: "example.org",
        relation: "same_site",
        fieldCategories: [
          "event_name",
          "page_url",
          "screen_size",
          "site_domain",
        ],
      }),
    );
    expect(initial.network).toContainEqual(
      expect.objectContaining({
        targetDomain: "example.net",
        relation: "cross_site",
        fieldCategories: ["identifier"],
        attempts: expect.any(Number),
        responses: 0,
      }),
    );
    for (const [source, fields] of [
      ["text", ["email_value"]],
      ["form", ["email", "email_value"]],
      ["query", ["email_value"]],
    ] as const) {
      expect(initial.network).toContainEqual(
        expect.objectContaining({
          sources: [source],
          fieldCategories: fields,
          attempts: 1,
          responses: 1,
        }),
      );
    }
    expect(
      initial.network.filter((row) =>
        row.fieldCategories.includes("email_value"),
      ),
    ).toHaveLength(4);
    expect(
      rejected.network.some((row) =>
        row.fieldCategories.includes("advertising_id"),
      ),
    ).toBe(false);
    expect(initial.network).toContainEqual(
      expect.objectContaining({
        method: "OTHER",
        fieldCategories: ["screen_size"],
        sources: ["json"],
        responses: 1,
      }),
    );
    expect(initial.requestInspection.examined).toBe(initial.requests);
    expect(initial.requestInspection.limitReached).toBe(true);
    expect(initial.requestInspection.matched).toBe(
      initial.network.reduce((count, row) => count + row.attempts, 0),
    );
    expect(accepted.network).toContainEqual(
      expect.objectContaining({
        phase: "after_choice",
        fieldCategories: ["advertising_id"],
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /(?:secret@|secret%40|sample-click|private-id|unrecognized_name|generic-event|\/aborted|\/api\/event|response-only-address)/,
    );
  } finally {
    await browser.close();
    server.close();
  }
});
