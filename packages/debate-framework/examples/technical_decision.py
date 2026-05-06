"""Architecture decision debate with file artifacts."""

import asyncio
import tempfile

from debate import DebateFramework, DebateConfig, MockLLM


async def main():
    llm = MockLLM(responses=[
        '{"position": "Use PostgreSQL for the primary datastore", '
        '"arguments": ['
        '{"point": "ACID compliance", "evidence": "Financial data requires strong consistency"},'
        '{"point": "JSON support", "evidence": "JSONB columns handle semi-structured data without a separate document store"},'
        '{"point": "Ecosystem maturity", "evidence": "Battle-tested, excellent tooling, large talent pool"}'
        '], "concessions": []}',

        '{"position": "PostgreSQL is solid but consider the read-heavy workload", '
        '"arguments": ['
        '{"point": "ACID compliance", "evidence": "Correct for financial data", "verdict": "ACCEPT"},'
        '{"point": "JSON support", "evidence": "Works but query performance degrades at scale", "verdict": "REVISE"},'
        '{"point": "Read replicas", "evidence": "Need to plan for read-heavy analytics from day 1", "verdict": "REVISE"}'
        '], "concessions": []}',

        '{"position": "PostgreSQL with read replicas and caching layer", '
        '"arguments": ['
        '{"point": "Add read replicas", "evidence": "Streaming replication handles analytics reads"},'
        '{"point": "Redis cache for hot paths", "evidence": "Dashboard queries hit cache, not primary DB"},'
        '{"point": "JSONB indexing", "evidence": "GIN indexes on JSONB fields keep query performance acceptable"}'
        '], "concessions": ["Read-heavy workload needs explicit planning", "JSONB alone is not enough at scale"]}',

        '{"position": "Revised PostgreSQL proposal addresses concerns", '
        '"arguments": ['
        '{"point": "Read replicas", "evidence": "Streaming replication is the right approach", "verdict": "ACCEPT"},'
        '{"point": "Caching strategy", "evidence": "Redis for hot paths is standard and effective", "verdict": "ACCEPT"},'
        '{"point": "JSONB indexing", "evidence": "GIN indexes are correct but monitor query plans", "verdict": "ACCEPT"}'
        '], "concessions": []}',
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        config = DebateConfig(
            topic="",  # Set by framework.run()
            protocol="adversarial",
            max_rounds=3,
            artifact_dir=tmpdir,
        )

        framework = DebateFramework(llm)
        result = await framework.run(
            topic="Which database should we use for our fintech SaaS platform?",
            context=(
                "Building a fintech SaaS with ~10K transactions/day initially, "
                "growing to 1M/day. Read-heavy analytics dashboard. "
                "Team has PostgreSQL and MongoDB experience."
            ),
            config=config,
        )

        print(f"Converged: {result.converged}")
        print(f"Score: {result.convergence_score:.0%}")
        print(f"\nSummary: {result.summary}")
        print(f"\nRecommendation: {result.recommendation}")
        print(f"\nArtifacts saved to: {tmpdir}")
        for path in result.artifact_paths:
            print(f"  - {path.name}")


if __name__ == "__main__":
    asyncio.run(main())
