# AI usage disclosure


## Draft paragraph

The source code, tests, and documentation of this tool were developed with the assistance of an AI coding assistant (Anthropic's Claude, used through Claude Code). The AI was used to write and refactor the TypeScript/React code, including the
finite element routines (2D and 3D frame element stiffness matrices, coordinate transformation, assembly, boundary-condition
handling, static condensation for hinges, Gaussian elimination), the user interface, the unit tests, and the written
documentation.

**How the work was checked.** The results were verified rather than taken on trust: (1) an automated test suite (121 tests)
checks element matrices (symmetry, rigid-body modes, orthogonality of the transformation, the 3D bending sign pattern),
equilibrium of every element and of the whole structure, rotation invariance, and mechanism detection;
(2) Examples A–C reproduce the values printed in Logan's *A First Course in the Finite Element Method* (Example 5.1 and
problems 4.41–4.43), and Example C was also checked against an independent statics-and-compatibility hand calculation;
(3) the 3D cantilever (Example D) matches the closed-form tip deflection and support reactions, and the 3D space frame
(Example E) satisfies equilibrium and a symmetry check; (4) the interface was run in a web browser for every example and every solution step.
During development the AI made at least one error in a hand calculation (a rotational stiffness of 3EI/L where 4EI/L applies),
which these independent checks caught and which was corrected.

**The running tool uses no AI.** The finished web application performs all calculations and generates all explanatory
text with ordinary deterministic code and fixed templates. It makes no calls to any AI chatbot, language model, or external
service while running, and it produces identical output for identical input.

I verified the solver against hand calculations and independent reference results, reviewed the explanations for correctness, and tested the interface.

