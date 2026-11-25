import { Table } from "@heroui/react";

export type VisitRow = {
  label: string;
  outside?: number;
  cookies?: number;
  unavailable?: string;
  source?: string;
};

export function ConsentTable({
  rows,
  label,
}: {
  rows: VisitRow[];
  label: string;
}) {
  return (
    <Table className="my-2 min-w-0">
      <Table.ScrollContainer>
        <Table.Content aria-label={label} className="w-full text-xs sm:text-sm">
          <Table.Header>
            <Table.Column isRowHeader>Visit</Table.Column>
            <Table.Column>Outside domains</Table.Column>
            <Table.Column>Cookies at end</Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row id={row.label} key={row.label}>
                <Table.Cell>
                  {row.source ? (
                    <a
                      className="inline-link"
                      href={"#evidence-" + row.source}
                      aria-label={row.label + " evidence"}
                    >
                      {row.label}
                    </a>
                  ) : (
                    row.label
                  )}
                  {row.unavailable && (
                    <span className="block max-w-56 text-xs font-normal whitespace-normal text-muted">
                      {row.unavailable}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {row.outside === 20 ? "20+" : (row.outside ?? "—")}
                </Table.Cell>
                <Table.Cell>{row.cookies ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
