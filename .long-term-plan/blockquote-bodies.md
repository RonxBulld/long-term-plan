<!-- long-term-plan:format=v1 -->

# Blockquote bodies

## Inbox

- [√] Spec blockquote bodies in MCP_TODO_DESIGN.md <!-- long-term-plan:id=t_571467cf42514db2a8c981f49734b07c -->
- [√] Parse blockquote bodies (plan/task) <!-- long-term-plan:id=t_b7e7fc09663d48fa8a5db491cfed924d -->
  - [√] Task body: read contiguous blockquote run after task line <!-- long-term-plan:id=t_0b3714f110364728a873a65e95b12033 -->
  - [√] Plan body: read contiguous blockquote run after H1 title <!-- long-term-plan:id=t_78ab74fe7eb046ab980c71782c367142 -->
  - [√] Model: add hasBody/bodyMarkdown + source ranges <!-- long-term-plan:id=t_a7bd1da6214e4806a769bd1aea131c44 -->
  - [√] Read rule: allow indent >= taskIndent+2 <!-- long-term-plan:id=t_db356c35fdb44517aaa55c1d0422f07c -->
- [√] Edit/write blockquote bodies (minimal diff) <!-- long-term-plan:id=t_34fdc6df612546ac930f09ddff379a4d -->
  - [√] Write rule: encode with strict indent taskIndent+2 and > prefix <!-- long-term-plan:id=t_0f16a95b94dc43609d06cead5ee3ffc0 -->
  - [√] Add applySetTaskBody + applySetPlanBody <!-- long-term-plan:id=t_1b25661be0cf4f44acda52b126639095 -->
  - [√] task.add supports optional bodyMarkdown insertion <!-- long-term-plan:id=t_0449bc0102d641698d7a9ad9d994ac2b -->
  - [√] Clear body removes only the structured body block <!-- long-term-plan:id=t_d73e562f6fa74f17963ad0d93966857d -->
- [√] API: expose body fields + defaults <!-- long-term-plan:id=t_96a1b03832f542d29d0d741ff111ef12 -->
  - [√] task.get default includeBody=true; plan.get defaults false <!-- long-term-plan:id=t_befd20c30472444c9e358d52a18825bc -->
  - [√] plan.get add includeTaskBodies/includePlanBody flags <!-- long-term-plan:id=t_40eb057984394201aafc55c58d7dda22 -->
  - [√] task.update supports bodyMarkdown or clearBody (mutual exclusion) <!-- long-term-plan:id=t_110d36e847024059b1c9e969d10eff33 -->
  - [√] Add plan.update (title/bodyMarkdown/clearBody) <!-- long-term-plan:id=t_91adbd11cd354566a5f7b4773dbd818a -->
- [√] MCP server: tool schema + output updates <!-- long-term-plan:id=t_8fdc90012a1143419f55b0f783b15390 -->
  - [√] Update zod schemas for plan.get/task.get/task.add/task.update <!-- long-term-plan:id=t_48b8ff9ddae64f469993f862c87e42c8 -->
  - [√] Add plan.update tool <!-- long-term-plan:id=t_40a9c4d15d2f440a817ca84c9a336672 -->
  - [√] Update tool descriptions to mention blockquote bodies <!-- long-term-plan:id=t_e986c820d07b44a2960c51a5ef980250 -->
- [√] CLI: add body input flags <!-- long-term-plan:id=t_035da6ecb50b4835a9fd69d0b5e09dce -->
  - [√] Add --body-stdin / --body-file / --clear-body <!-- long-term-plan:id=t_8664b4e53ca2425a9d50f49be86f10ec -->
  - [√] Add ltp plan update command <!-- long-term-plan:id=t_67c5f6787a174ab795179b76ed0ce619 -->
  - [√] Update --help examples (heredoc / file) <!-- long-term-plan:id=t_c5943185f86943dd9be4cd0b100e7d9b -->
- [√] Docs: update format + CLI + server-mode <!-- long-term-plan:id=t_5ef4d327051c4b2789ba62c9a5494fbe -->
  - [√] agent-skill format-v1.md: document blockquote body rules <!-- long-term-plan:id=t_a0a29d7e93654a40b3a619ee4ec7a042 -->
  - [√] agent-skill cli.md: document new body flags <!-- long-term-plan:id=t_cb897702d8e6414f92c84637617a6042 -->
  - [√] agent-skill server-mode.md: document new tool params <!-- long-term-plan:id=t_00ffd356c81043ed97e85e2cc3d21e92 -->
  - [√] README.md: add multi-line body examples <!-- long-term-plan:id=t_1965791318d34bed9c252ec183008323 -->
- [√] Tests: parse/edit/API coverage for bodies <!-- long-term-plan:id=t_aaa08394a0574e5b814e8e450fd8966d -->
  - [√] Parse: body contains - [ ] / code fence / table <!-- long-term-plan:id=t_50876594e6444a0ebc7489fa35cde75d -->
  - [√] Edit: update/clear body produces minimal diffs <!-- long-term-plan:id=t_188bc2516085418ca291e3d03edb82c9 -->
  - [√] API: includeBody/includeTaskBodies/includePlanBody behavior <!-- long-term-plan:id=t_faea104a71c74103add95fd452addea9 -->
