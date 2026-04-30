// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { STANDARD_AGENT_PREFERRED_TOOL_IDS } from '../../src/constants';
import {
  TOOL_ADAPTER_IDS,
  TOOL_CATALOG,
  getHighImpactToolIds,
  getProviderFunctionToolIds,
  getReadOnlyToolIds,
  getToolActionType,
  getWorkflowSelectableToolIds,
} from '../../src/lib/toolCatalog';
import { WORKSPACE_TOOL_TEMPLATES } from '../../src/lib/workspaceFoundations';
import { TOOL_ID_ALIASES } from '../toolIds';
import {
  READ_ONLY_AGENT_TOOL_IDS,
  TOOL_REGISTRY,
  buildProviderToolDefinitions,
  getToolAdapter,
  listRegisteredToolIds,
} from '../execution/tools';

describe('tool catalog parity', () => {
  it('keeps the canonical tool ids, catalog, and runtime registry in sync', () => {
    expect(Object.keys(TOOL_CATALOG).sort()).toEqual([...TOOL_ADAPTER_IDS].sort());
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_ADAPTER_IDS].sort());
    expect(listRegisteredToolIds().sort()).toEqual([...TOOL_ADAPTER_IDS].sort());
  });

  it('keeps alias normalization pointed only at registered canonical tool ids', () => {
    expect(Object.values(TOOL_ID_ALIASES).every(toolId => toolId in TOOL_CATALOG)).toBe(true);
    expect(TOOL_ADAPTER_IDS.every(toolId => TOOL_ID_ALIASES[toolId] === toolId)).toBe(true);
  });

  it('keeps read-only ids, provider exposure, and workflow selectors aligned with the catalog', () => {
    expect([...READ_ONLY_AGENT_TOOL_IDS].sort()).toEqual(getReadOnlyToolIds().sort());
    expect(
      buildProviderToolDefinitions(TOOL_ADAPTER_IDS)
        .map(definition => definition.function.name)
        .sort(),
    ).toEqual(getProviderFunctionToolIds().sort());
    expect(WORKSPACE_TOOL_TEMPLATES.map(template => template.toolId).sort()).toEqual(
      getWorkflowSelectableToolIds().sort(),
    );
  });

  it('marks experimental tools explicitly and requires schemas for provider-exposed tools', () => {
    expect(TOOL_CATALOG.publish_bounty.experimental).toBe(true);
    expect(TOOL_CATALOG.resolve_bounty.experimental).toBe(true);
    expect(TOOL_CATALOG.wait_for_signal.experimental).toBe(true);

    for (const toolId of getProviderFunctionToolIds()) {
      expect(getToolAdapter(toolId).parameterSchema).toBeTruthy();
    }
  });

  it('keeps high-impact tools mapped to explicit policy action types', () => {
    for (const toolId of getHighImpactToolIds()) {
      expect(getToolActionType(toolId)).not.toBe('custom');
    }
  });

  it('keeps curated preferred-tool sets inside the canonical catalog', () => {
    const preferredToolIds = Object.values(STANDARD_AGENT_PREFERRED_TOOL_IDS).flat();
    expect(preferredToolIds.every(toolId => toolId in TOOL_CATALOG)).toBe(true);
  });
});
