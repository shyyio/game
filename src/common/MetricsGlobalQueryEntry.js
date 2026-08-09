/**
 * Declares one metrics type publicly queryable at GLOBAL scope, collected at ModRegistry.freeze()
 * from every mod's declaration.metricsGlobalQueries. Never wired.
 */
export class MetricsGlobalQueryEntry {

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {function(MetricsRollupRow): boolean|null} rowFilter keeps a row in a GLOBAL answer, or null for all rows
     */
    constructor(metricsType, rowFilter) {
        this.metricsType = metricsType;
        this.rowFilter = rowFilter;
    }
}
