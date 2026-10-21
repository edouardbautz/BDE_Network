import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { ScrollableTable } from './scrollable-table';

/**
 * A table that scrolls sideways must be a box the keyboard can reach: it has a name, takes the focus, and it is the box that
 * scrolls (the one of the shadcn/ui table, which cannot take attributes, is switched off).
 */
describe('ScrollableTable', () => {
  it('is a named region that takes the focus and holds the table', () => {
    render(
      <ScrollableTable label="Audit log">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>a cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ScrollableTable>,
    );
    const region = screen.getByRole('region', { name: 'Audit log' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toContainElement(screen.getByRole('table'));
  });

  it('is the box that scrolls, and the box of the table component is not', () => {
    render(
      <ScrollableTable label="Roles">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>a cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ScrollableTable>,
    );
    const region = screen.getByRole('region', { name: 'Roles' });
    expect(region.className).toContain('overflow-x-auto');
    expect(region.className).toContain('[&_[data-slot=table-container]]:overflow-visible');
    expect(region.querySelector('[data-slot="table-container"]')).not.toBeNull();
  });
});
