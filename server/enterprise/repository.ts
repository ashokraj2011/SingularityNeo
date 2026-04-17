import { query, transaction } from '../db';
import type {
  SsoIdentityLink,
  DirectoryGroupMapping,
  ServiceAccountPrincipal,
  SegregationOfDutiesPolicy,
  AccessAttestationRecord,
  CapabilityServiceProfile,
  ExecutionLane,
  RuntimeLanePolicy,
} from '../../src/types';

export const listSegregationOfDutiesPolicies = async (): Promise<SegregationOfDutiesPolicy[]> => {
  const result = await query(`
    SELECT *
    FROM segregation_of_duties_policies
    WHERE is_active = true
  `);
  return result.rows.map((row: any) => ({
    id: row.id,
    policyName: row.policy_name,
    description: row.description,
    restrictedAction: row.restricted_action,
    makerRole: row.maker_role,
    checkerRole: row.checker_role,
    preventSelfApproval: row.prevent_self_approval,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  }));
};

export const getCapabilityServiceProfile = async (
  capabilityId: string
): Promise<CapabilityServiceProfile | null> => {
  const result = await query(
    `SELECT * FROM capability_service_profiles WHERE capability_id = $1`,
    [capabilityId]
  );
  if (result.rows.length === 0) return null;
  const row: any = result.rows[0];
  
  return {
    capabilityId: row.capability_id,
    businessCriticality: row.business_criticality,
    serviceTier: row.service_tier,
    controlOwnerUserId: row.control_owner_user_id,
    productionOwnerUserId: row.production_owner_user_id,
    dataClassification: row.data_classification,
    rtoRpoTarget: row.rto_rpo_target,
    updatedAt: row.updated_at,
  };
};

export const upsertCapabilityServiceProfile = async (
  profile: CapabilityServiceProfile
): Promise<CapabilityServiceProfile> => {
  const result = await query(`
    INSERT INTO capability_service_profiles (
      capability_id, business_criticality, service_tier, 
      control_owner_user_id, production_owner_user_id, 
      data_classification, rto_rpo_target, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (capability_id) DO UPDATE SET
      business_criticality = EXCLUDED.business_criticality,
      service_tier = EXCLUDED.service_tier,
      control_owner_user_id = EXCLUDED.control_owner_user_id,
      production_owner_user_id = EXCLUDED.production_owner_user_id,
      data_classification = EXCLUDED.data_classification,
      rto_rpo_target = EXCLUDED.rto_rpo_target,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [
    profile.capabilityId,
    profile.businessCriticality,
    profile.serviceTier,
    profile.controlOwnerUserId,
    profile.productionOwnerUserId,
    profile.dataClassification,
    profile.rtoRpoTarget,
    new Date().toISOString(),
  ]);
  
  const row: any = result.rows[0];
  return {
    capabilityId: row.capability_id,
    businessCriticality: row.business_criticality,
    serviceTier: row.service_tier,
    controlOwnerUserId: row.control_owner_user_id,
    productionOwnerUserId: row.production_owner_user_id,
    dataClassification: row.data_classification,
    rtoRpoTarget: row.rto_rpo_target,
    updatedAt: row.updated_at,
  };
};

export const getExternalIdentity = async (ssoProvider: string, ssoSubjectId: string): Promise<SsoIdentityLink | null> => {
  const result = await query(
    `SELECT * FROM external_identity_links WHERE sso_provider = $1 AND sso_subject_id = $2`,
    [ssoProvider, ssoSubjectId]
  );
  if (result.rows.length === 0) return null;
  const row: any = result.rows[0];
  return {
    userId: row.user_id,
    ssoProvider: row.sso_provider,
    ssoSubjectId: row.sso_subject_id,
    linkedAt: row.linked_at,
  };
};

export const listExecutionLanes = async (capabilityId?: string): Promise<ExecutionLane[]> => {
  let queryText = `SELECT * FROM execution_lanes WHERE is_active = true`;
  let params: any[] = [];
  
  if (capabilityId) {
    queryText = `
      SELECT el.* 
      FROM execution_lanes el
      JOIN runtime_lane_policies rlp ON el.id = rlp.execution_lane_id
      WHERE rlp.capability_id = $1 AND el.is_active = true
      ORDER BY rlp.priority DESC
    `;
    params = [capabilityId];
  }
  
  const result = await query(queryText, params);
  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    laneType: row.lane_type,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
};
