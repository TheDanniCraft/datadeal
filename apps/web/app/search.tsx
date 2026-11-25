"use client";

import {
  Avatar,
  Button,
  FieldError,
  InputGroup,
  Label,
  TextField,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { domain } from "@datadeal/contracts";
import { bundledSiteFavicon } from "../lib/site-favicon";

export function DomainSearch({
  autoFocus = false,
  onNavigate,
}: { autoFocus?: boolean; onNavigate?: () => void } = {}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [iconHost, setIconHost] = useState<string>();
  const parsedDomain = domain.safeParse(value);
  const host = parsedDomain.success ? parsedDomain.data : undefined;
  useEffect(() => {
    if (!host) return;
    const timer = setTimeout(() => setIconHost(host), 400);
    return () => clearTimeout(timer);
  }, [host]);
  return (
    <form
      className="grid w-full max-w-2xl gap-2 sm:flex sm:items-end"
      action="/search"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = domain.safeParse(
          new FormData(event.currentTarget).get("domain"),
        );
        if (!parsed.success) {
          setError("Enter a public domain, such as example.com.");
          return;
        }
        onNavigate?.();
        router.push("/report/" + parsed.data);
      }}
    >
      <TextField
        name="domain"
        className="min-w-0 flex-1"
        isRequired
        isInvalid={!!error}
        onChange={(next) => {
          setError("");
          setValue(next);
        }}
      >
        <Label>Website domain</Label>
        <InputGroup>
          {host && (
            <InputGroup.Prefix>
              <Avatar
                size="sm"
                key={host}
                aria-hidden="true"
                className="size-5 rounded-none! bg-transparent!"
              >
                {iconHost === host && (
                  <Avatar.Image
                    className="rounded-none! object-contain!"
                    alt=""
                    src={
                      bundledSiteFavicon(host) ??
                      `/api/v1/domains/${host}/favicon`
                    }
                  />
                )}
                <Avatar.Fallback className="bg-transparent!">◎</Avatar.Fallback>
              </Avatar>
            </InputGroup.Prefix>
          )}
          <InputGroup.Input
            className="min-h-11 w-full"
            autoFocus={autoFocus}
            placeholder="example.com"
            autoCapitalize="none"
            spellCheck={false}
          />
        </InputGroup>
        {error && <FieldError>{error}</FieldError>}
      </TextField>
      <Button
        type="submit"
        variant="primary"
        className="min-h-11 w-full shrink-0 sm:w-auto"
      >
        Check website <span aria-hidden="true">→</span>
      </Button>
    </form>
  );
}
