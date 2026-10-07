/**
 * Native loading retains other symbols' drawings in every chart. Saving those
 * hidden copies lets another symbol's tab overwrite a newer edit or deletion.
 * Filter within each chart before the host deduplicates drawing IDs globally;
 * indicator panes inherit their chart's symbol rather than requiring a local
 * MainSeries. The native extractor still writes explicit empty active groups.
 */
export function scopeChartDrawingSnapshot(save) {
  return {
    ...save,
    charts: save.charts.map(chart => {
      const sources = chart.panes.flatMap(pane => pane.sources);
      const symbols = new Set(sources.filter(source => source.type === 'MainSeries')
        .map(source => source.state.symbol.toUpperCase()));
      if (symbols.size === 0 && sources.some(source => source.type.startsWith('LineTool'))) {
        throw new Error('Drawing save requires a MainSeries symbol for its chart');
      }
      return {
        ...chart,
        panes: chart.panes.map(pane => ({
          ...pane,
          sources: pane.sources.filter(source => !source.type.startsWith('LineTool')
            || symbols.has(source.state.symbol.toUpperCase())),
        })),
      };
    }),
  };
}
