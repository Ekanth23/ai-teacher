CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_nodes_id_structure
  ON curriculum_nodes (id, curriculum_structure_id);

ALTER TABLE curriculum_nodes
  ADD CONSTRAINT curriculum_nodes_parent_same_structure_fk
  FOREIGN KEY (parent_node_id, curriculum_structure_id)
  REFERENCES curriculum_nodes (id, curriculum_structure_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_target_pathway_stages_id_version
  ON target_pathway_stages (id, target_pathway_version_id);

ALTER TABLE target_pathway_requirements
  ADD CONSTRAINT target_pathway_requirements_stage_same_version_fk
  FOREIGN KEY (target_pathway_stage_id, target_pathway_version_id)
  REFERENCES target_pathway_stages (id, target_pathway_version_id);
