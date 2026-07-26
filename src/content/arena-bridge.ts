/**
 * Phase 0A content-script entry point.
 *
 * It deliberately performs no DOM reads/writes and accepts no page messages.
 * Phase 0C will replace this placeholder with the allow-listed, schema-validated
 * Content Bridge. Keeping the entry point inert prevents an implicit page ↔
 * extension trust boundary before that protocol has been reviewed and tested.
 */
console.debug('[AAMP] Arena content bridge reserved for Phase 0C.');
