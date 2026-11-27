import { describe, expect, it } from "vitest";
import { alertMailer, alertMessage } from "./alert-mail";

describe("alert mail", () => {
  it("names the site and the change, and links the scan and the Library", () => {
    const mail = alertMessage(
      "https://datadeal.example",
      {
        scan_id: "0b6d2c3e-0000-4000-8000-000000000001",
        domain: "bild.de",
        document_count: 2,
        score_before: 41,
        score_after: 36,
      },
      "reader@example.test",
    );
    expect(mail.subject).toBe("bild.de changed: score 41 → 36");
    expect(mail.text).toContain("Score: 41 → 36");
    expect(mail.text).toContain("2 privacy documents changed");
    expect(mail.text).toContain(
      "https://datadeal.example/report/bild.de?scan=0b6d2c3e-0000-4000-8000-000000000001#history",
    );
    expect(mail.text).toContain("https://datadeal.example/account/library");
    expect(mail.html).toContain('<a href="https://datadeal.example/report/');
  });

  it("uses the account mail transport and skips sending without one", () => {
    expect(alertMailer({})).toBeNull();
    expect(alertMailer({ APP_ORIGIN: "https://datadeal.example" })).toBeNull();
    expect(
      alertMailer({
        APP_ORIGIN: "https://datadeal.example",
        DATADEAL_MAIL_MODE: "resend",
        RESEND_API_KEY: "test-key",
      }),
    ).toBeNull();
    expect(
      alertMailer({
        APP_ORIGIN: "https://datadeal.example",
        DATADEAL_MAIL_MODE: "resend",
        RESEND_API_KEY: "test-key",
        DATADEAL_MAIL_FROM: "DataDeal <alerts@datadeal.example>",
      })?.origin,
    ).toBe("https://datadeal.example");
    // The local outbox works only in development on this computer.
    const local = {
      APP_ORIGIN: "http://localhost:3000",
      DATADEAL_MAIL_MODE: "local",
      DATADEAL_LOCAL_MAIL_FILE: "outbox.txt",
    };
    expect(alertMailer({ ...local, NODE_ENV: "production" })).toBeNull();
    expect(alertMailer({ ...local, NODE_ENV: "development" })?.origin).toBe(
      "http://localhost:3000",
    );
  });
});
