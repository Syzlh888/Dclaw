import { create } from 'zustand';
import type { QueryResult, AggregatedResult, ResultRow, CellValue } from '../types/result';
import { DiffType } from '../types/result';

interface ResultState {
  results: Record<string, QueryResult>;
  aggregatedResult: AggregatedResult | null;
  compareSources: string[];
  selectedDbId: string | null;
  pinnedResults: Record<string, QueryResult>;

  setResult: (dbConnectionId: string, result: QueryResult) => void;
  aggregate: () => void;
  compare: (sources: string[]) => AggregatedResult | null;
  reset: () => void;
  setSelectedDbId: (id: string | null) => void;
  pinResult: (dbConnectionId: string) => void;
  unpinResult: (dbConnectionId: string) => void;
}

export const useResultStore = create<ResultState>((set, get) => ({
  results: {},
  aggregatedResult: null,
  compareSources: [],
  selectedDbId: null,
  pinnedResults: {},

  setResult: (dbConnectionId, result) => {
    set((state) => ({
      results: { ...state.results, [dbConnectionId]: result },
    }));
    // 每次写入结果后都自动重新聚合，确保所有库的结果都被合并
    get().aggregate();
  },

  aggregate: () => {
    const { results } = get();
    const allResults = Object.values(results);
    if (allResults.length === 0) {
      set({ aggregatedResult: null });
      return;
    }

    // Collect union of columns (excluding source column)
    const columnSet = new Set<string>();
    allResults.forEach((r) => {
      r.columns.forEach((col) => columnSet.add(col));
    });
    const columns = ['来源库', ...Array.from(columnSet)];

    // Merge all rows
    const rows: ResultRow[] = [];
    const sources: string[] = [];
    allResults.forEach((r) => {
      sources.push(r.sourceLabel);
      r.rows.forEach((row) => {
        const newValues: Record<string, CellValue> = {
          '来源库': { value: r.sourceLabel, diffType: DiffType.Same },
        };
        Array.from(columnSet).forEach((col) => {
          if (row.values[col]) {
            newValues[col] = { ...row.values[col] };
          } else {
            newValues[col] = { value: null, diffType: DiffType.Missing };
          }
        });
        rows.push({
          sourceDbLabel: row.sourceDbLabel,
          values: newValues,
        });
      });
    });

    set({ aggregatedResult: { columns, rows, sources } });
  },

  compare: (sources) => {
    const { results } = get();
    const selectedResults = sources
      .map((s) => results[s])
      .filter((r): r is QueryResult => r !== undefined);

    if (selectedResults.length < 2) return null;

    // Collect intersection of columns
    const columnSets = selectedResults.map((r) => new Set(r.columns));
    const intersection = columnSets.reduce((a, b) => {
      return new Set([...a].filter((x) => b.has(x)));
    });

    const columns = Array.from(intersection);
    const maxRows = Math.max(...selectedResults.map((r) => r.rows.length));

    const rows: ResultRow[] = [];
    for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
      const values: Record<string, CellValue> = {};

      columns.forEach((col) => {
        const cellValues: any[] = [];
        let allSame = true;
        let hasMissing = false;
        let firstVal: any = undefined;

        selectedResults.forEach((r, srcIdx) => {
          const row = r.rows[rowIdx];
          if (!row) {
            hasMissing = true;
            cellValues.push(undefined);
          } else {
            const cellVal = row.values[col]?.value;
            cellValues.push(cellVal);
            if (srcIdx === 0) {
              firstVal = cellVal;
            } else if (cellVal !== firstVal) {
              allSame = false;
            }
          }
        });

        let diffType: DiffType;
        if (hasMissing) {
          diffType = DiffType.Missing;
        } else if (allSame) {
          diffType = DiffType.Same;
        } else {
          diffType = DiffType.Different;
        }

        values[col] = { value: cellValues, diffType };
      });

      rows.push({
        sourceDbLabel: `Row ${rowIdx + 1}`,
        values,
      });
    }

    const compareResult: AggregatedResult = {
      columns,
      rows,
      sources,
    };

    set({ compareSources: sources });
    return compareResult;
  },

  reset: () => {
    set({ results: {}, aggregatedResult: null, compareSources: [], selectedDbId: null });
  },

  setSelectedDbId: (id) => {
    set({ selectedDbId: id });
  },

  pinResult: (dbConnectionId) => {
    const { results } = get();
    const result = results[dbConnectionId];
    if (result) {
      set((state) => ({
        pinnedResults: { ...state.pinnedResults, [dbConnectionId]: result },
      }));
    }
  },

  unpinResult: (dbConnectionId) => {
    set((state) => {
      const { [dbConnectionId]: _, ...rest } = state.pinnedResults;
      return { pinnedResults: rest };
    });
  },
}));
