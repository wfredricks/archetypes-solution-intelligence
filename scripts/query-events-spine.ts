/**
 * Read-only inspector for the events-spine contract + hypothesis state
 * in the asi SIG. Dumps the full sub-graph (Contract envelope +
 * Principles, Constraints, Services, Processes, DataObjects,
 * Hypotheses) as JSON to stdout.
 *
 * // Why: prefer this over cypher-shell when you want a single-shot
 * // structured dump of the contract — useful for spot-checks during
 * // writeback runs and for grep-friendly diffs across snapshots.
 *
 * // Idempotency: read-only. Safe to re-run. No SIG mutation.
 *
 * // Usage:
 * //   npx tsx scripts/query-events-spine.ts
 *
 * @module scripts/query-events-spine
 */

import neo4j from 'neo4j-driver';

const driver = neo4j.driver('bolt://localhost:7689', neo4j.auth.basic('neo4j', 'udt-pass-2026'));
const session = driver.session();

async function run() {
  const result = await session.run(`
    MATCH (s:Solution {namespace: "asi"})-[:HAS_CONTRACT]->(c:Contract {archetypeName: "events-spine"})
    OPTIONAL MATCH (c)-[:DECLARES_PRINCIPLE]->(p:Principle)
    OPTIONAL MATCH (c)-[:DECLARES_CONSTRAINT]->(co:Constraint)
    OPTIONAL MATCH (c)-[:DECLARES_SERVICE]->(sv:Service)
    OPTIONAL MATCH (c)-[:DECLARES_PROCESS]->(pr:Process)
    OPTIONAL MATCH (c)-[:DECLARES_DATAOBJECT]->(do:DataObject)
    OPTIONAL MATCH (c)-[:DECLARES_HYPOTHESIS]->(h:Hypothesis)
    RETURN c, collect(distinct p{.*}) AS principles, collect(distinct co{.*}) AS constraints,
           collect(distinct sv{.*}) AS services, collect(distinct pr{.*}) AS processes,
           collect(distinct do{.*}) AS dataObjects, collect(distinct h{.*}) AS hypotheses
  `);

  for (const rec of result.records) {
    const c = rec.get('c').properties;
    console.log('CONTRACT:', JSON.stringify(c, null, 2));
    console.log('PRINCIPLES:', JSON.stringify(rec.get('principles'), null, 2));
    console.log('CONSTRAINTS:', JSON.stringify(rec.get('constraints'), null, 2));
    console.log('SERVICES:', JSON.stringify(rec.get('services'), null, 2));
    console.log('PROCESSES:', JSON.stringify(rec.get('processes'), null, 2));
    console.log('DATAOBJECTS:', JSON.stringify(rec.get('dataObjects'), null, 2));
    console.log('HYPOTHESES:', JSON.stringify(rec.get('hypotheses'), null, 2));
  }

  await session.close();
  await driver.close();
}

run().catch(e => { console.error(e); process.exit(1); });
