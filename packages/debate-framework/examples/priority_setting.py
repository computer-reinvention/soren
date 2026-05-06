"""Multi-criteria priority debate using the panel protocol."""

import asyncio

from debate import DebateFramework, DebateConfig, DefenderAgent, CriticAgent, MockLLM


async def main():
    llm = MockLLM(responses=[
        # Proposer (defender)
        '{"position": "Priority order: Auth system > Payment integration > Admin dashboard", '
        '"arguments": ['
        '{"point": "Auth blocks everything", "evidence": "No feature works without user accounts"},'
        '{"point": "Payments = revenue", "evidence": "Earlier payments means earlier revenue validation"},'
        '{"point": "Admin can wait", "evidence": "Manual DB queries suffice for first 100 users"}'
        '], "concessions": []}',

        # Judge 1 (critic)
        '{"position": "Mostly agree but admin needs earlier attention", '
        '"arguments": ['
        '{"point": "Auth first", "evidence": "Correct dependency analysis", "verdict": "ACCEPT"},'
        '{"point": "Payments second", "evidence": "Agreed, validates business model", "verdict": "ACCEPT"},'
        '{"point": "Admin timing", "evidence": "Manual queries become unsustainable fast", "verdict": "REVISE"}'
        '], "concessions": []}',

        # Judge 2 (critic)
        '{"position": "Auth first is right, but consider payment provider lead time", '
        '"arguments": ['
        '{"point": "Auth first", "evidence": "No disagreement", "verdict": "ACCEPT"},'
        '{"point": "Payment lead time", "evidence": "Stripe onboarding takes 2-3 weeks, start in parallel", "verdict": "REVISE"},'
        '{"point": "Admin dashboard", "evidence": "Agree it can wait", "verdict": "ACCEPT"}'
        '], "concessions": []}',

        # Proposer rebuttal
        '{"position": "Auth first, start Stripe onboarding in parallel, basic admin after payments", '
        '"arguments": ['
        '{"point": "Parallel Stripe setup", "evidence": "Start onboarding while building auth"},'
        '{"point": "Lightweight admin", "evidence": "Simple read-only dashboard before full admin"}'
        '], "concessions": ["Stripe onboarding should start earlier", "Basic admin view needed sooner than full dashboard"]}',

        # Judge 1 final
        '{"position": "Revised plan is solid", '
        '"arguments": ['
        '{"point": "Parallel tracks", "evidence": "Practical and efficient", "verdict": "ACCEPT"},'
        '{"point": "Lightweight admin", "evidence": "Good compromise", "verdict": "ACCEPT"}'
        '], "concessions": []}',

        # Judge 2 final
        '{"position": "Approved with parallel execution", '
        '"arguments": ['
        '{"point": "Execution plan", "evidence": "Addresses lead time concern", "verdict": "ACCEPT"},'
        '{"point": "Admin scope", "evidence": "Read-only first is pragmatic", "verdict": "ACCEPT"}'
        '], "concessions": []}',
    ])

    config = DebateConfig(
        topic="",
        protocol="panel",
        max_rounds=2,
    )

    # Create a panel: 1 proposer + 2 judges
    agents = [
        DefenderAgent(llm),
        CriticAgent(llm, system_prompt="You are Judge 1, focused on engineering feasibility."),
        CriticAgent(llm, system_prompt="You are Judge 2, focused on business impact and timelines."),
    ]
    # Give unique roles for round tracking
    agents[1].role = "judge-1"
    agents[2].role = "judge-2"

    framework = DebateFramework(llm)
    result = await framework.run(
        topic="What should our MVP feature priority order be?",
        context=(
            "Early-stage SaaS startup. 2 developers, 3-month runway. "
            "Features to prioritize: auth system, payment integration, "
            "admin dashboard, notification system, analytics."
        ),
        config=config,
        agents=agents,
    )

    print(f"Converged: {result.converged}")
    print(f"Score: {result.convergence_score:.0%}")
    print(f"\nSummary: {result.summary}")
    print(f"\nAccepted: {result.synthesis.accepted_points}")
    print(f"Revised: {result.synthesis.revised_points}")
    print(f"\nRecommendation: {result.recommendation}")


if __name__ == "__main__":
    asyncio.run(main())
