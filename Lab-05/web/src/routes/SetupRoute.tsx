/** Tenant setup: the key, the widget's appearance, and the embed snippet.
 *
 * Colour, greeting and corner. No drag-and-drop editor — v1 is deliberately
 * small, and a widget the agency can restyle freely is a widget that can be
 * made to look like something it is not.
 *
 * Rotate and "Send to developer" are inert here and say so. This lab issues
 * no keys, and a button that looks like it rotated a live credential without
 * doing so is worse than one that admits it is a placeholder.
 */
import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Kicker, Tag } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { ChatPanel } from "@/components/widget/ChatPanel";
import { embedSnippet, WIDGET_ACCENTS } from "@/data/fixtures/tenant";
import { repo } from "@/data/repo";
import type { TenantConfig } from "@/data/types";
import { AgencyDetailsCard } from "@/components/setup/AgencyDetailsCard";

export function SetupRoute() {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [accent, setAccent] = useState(WIDGET_ACCENTS[0]);
  const [greeting, setGreeting] = useState("");
  const [position, setPosition] = useState<"left" | "right">("right");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void repo.getTenant().then((t) => {
      if (cancelled) return;
      setTenant(t);
      setAccent(t.widget.accent);
      setGreeting(t.widget.greeting);
      setPosition(t.widget.position);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tenant) return null;

  const snippet = embedSnippet(tenant.public_key, position);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission). The snippet
      // is on screen and selectable, so nothing is actually lost.
      setCopied(false);
    }
  }

  return (
    <div className="max-w-[1080px] px-8 pb-12 pt-[34px]">
      <h2 className="m-0 text-[32px]">Setup</h2>
      <p
        className="max-w-[60ch] text-sm"
        style={{ color: "var(--color-neutral-700)" }}
      >
        One snippet on your site. Colour and greeting only — no drag-and-drop
        editor in v1.
      </p>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_340px] gap-[22px]">
        <div className="flex flex-col gap-4">
          <AgencyDetailsCard />
          <Card className="rounded-md p-[18px]">
            <CardTitle className="mb-3">API key</CardTitle>
            <dl className="m-0 flex flex-col gap-2.5 text-[13px]">
              <Row label="Public key">
                <span className="figure text-[12.5px]">
                  {tenant.public_key}
                </span>
              </Row>
              <Row label="Secret">
                <span className="figure text-[12.5px]">
                  {tenant.secret_key_masked}
                </span>
                <Button variant="ghost" className="text-[12px]" disabled>
                  Rotate
                </Button>
                <span
                  className="text-[11.5px]"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  Not wired up in this lab
                </span>
              </Row>
              <Row label="Allowed origins">
                <span className="flex flex-wrap gap-1.5">
                  {tenant.allowed_origins.map((origin) => (
                    <Tag key={origin} tone="neutral" className="text-[11px]">
                      {origin}
                    </Tag>
                  ))}
                </span>
              </Row>
              <Row label="Last used">{tenant.last_used}</Row>
            </dl>
          </Card>

          <Card className="rounded-md p-[18px]">
            <CardTitle className="mb-3">Widget</CardTitle>
            <div className="flex flex-col gap-3.5">
              <div>
                <Kicker>Brand colour</Kicker>
                <div
                  className="mt-1.5 flex gap-2.5"
                  role="radiogroup"
                  aria-label="Brand colour"
                >
                  {WIDGET_ACCENTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={accent === value}
                      aria-label={`Brand colour ${value}`}
                      onClick={() => setAccent(value)}
                      className="h-[34px] w-[34px] cursor-pointer rounded-pill"
                      style={{
                        background: value,
                        boxShadow:
                          accent === value
                            ? "0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-text)"
                            : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="greeting" className="kicker block">
                  Greeting
                </label>
                <input
                  id="greeting"
                  className="input mt-1.5"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                />
              </div>

              <div>
                <Kicker>Position</Kicker>
                <Tabs
                  className="mt-1.5"
                  label="Widget position"
                  value={position}
                  onChange={setPosition}
                  items={[
                    { value: "right", label: "Bottom right" },
                    { value: "left", label: "Bottom left" },
                  ]}
                />
              </div>
            </div>
          </Card>

          <Card className="rounded-md p-[18px]">
            <CardTitle className="mb-2.5">Embed</CardTitle>
            <pre
              className="figure m-0 overflow-x-auto rounded-sm p-3.5 text-[12px]"
              style={{
                background: "var(--color-neutral-900)",
                color: "var(--color-neutral-100)",
              }}
            >
              {snippet}
            </pre>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy snippet"}
              </Button>
              <Button variant="secondary" disabled>
                Send to developer
              </Button>
              <span
                className="text-[11.5px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                Not wired up in this lab
              </span>
            </div>
          </Card>
        </div>

        <div>
          <Kicker>Preview</Kicker>
          <div
            className="relative mt-1.5 h-[520px] overflow-hidden rounded-lg"
            style={{
              border: "1px solid var(--color-divider)",
              background: "var(--color-neutral-200)",
            }}
          >
            {/* The real panel, not a picture of one — so the accent and the
                greeting are seen in the component that will ship them. */}
            <div
              className="absolute bottom-4 w-[300px]"
              style={
                position === "left"
                  ? { left: 16, right: "auto" }
                  : { right: 16, left: "auto" }
              }
            >
              <ChatPanel
                items={[]}
                running={false}
                fatal={null}
                onSend={() => {}}
                greeting={greeting}
                accent={accent}
                className="h-[380px]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <dt
        className="w-[126px] flex-none"
        style={{ color: "var(--color-neutral-600)" }}
      >
        {label}
      </dt>
      <dd className="m-0 flex flex-1 items-center gap-2.5">{children}</dd>
    </div>
  );
}
