import { useEffect, useMemo, useState } from 'react';
import { pieTableMarkers } from './pie-table.js';

// Multiple pairs own independent searches. A sole pair shares the tile's controls
// row; either way the pie keeps the complete distribution while the table is searched.
export default function ReportPieTable({ pair, children, search = null }) {
  const [localQuery, setQuery] = useState('');
  const query = search ? search.query : localQuery;
  const { pieModel, tableModel } = pair;
  useEffect(() => { setQuery(''); }, [tableModel.rowType, tableModel.rowDimension]);
  const markerFor = useMemo(() => pieTableMarkers(pieModel.slices), [pieModel.slices]);
  return (
    <div className="rpt-pair-row">
      {tableModel.search && !search && <div className="rpt-find rpt-pair-search">
        <input type="text" className="text-11 rpt-find-in" value={query}
          placeholder="Filter segments..." aria-label={`Filter ${tableModel.rowLabel} rows`}
          onChange={(event) => setQuery(event.target.value)} />
      </div>}
      <div className="rpt-pair-body">
        {children({ query, markerFor })}
      </div>
    </div>
  );
}
