import type { PoolClient } from "pg";

export type QuestionnaireType = "ANAMNESIS" | "CHECKIN";
export type AnswerValueType = "NUMBER" | "BOOLEAN" | "OPTION" | "TEXT" | "DATE";

export interface QuestionnaireVersionRow {
  id: string;
  category_config_id: string;
  questionnaire_type: QuestionnaireType;
  version: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
}

export interface QuestionnaireFieldRow {
  id: string;
  questionnaire_version_id: string;
  field_key: string;
  label: string;
  value_type: AnswerValueType;
  required: boolean;
  order_index: number;
  options: unknown;
}

/**
 * Questionários (anamnese/check-in) são versionados por categoria — uma
 * mudança futura de campos NUNCA reinterpreta respostas já coletadas sob
 * uma versão anterior, porque cada CheckIn referencia a versão vigente no
 * momento em que foi criado (`check_ins.questionnaire_version_id`), não a
 * versão "atual".
 */
export class QuestionnaireService {
  async getCurrentVersion(
    client: PoolClient,
    categoryConfigId: string,
    type: QuestionnaireType
  ): Promise<QuestionnaireVersionRow> {
    const { rows } = await client.query<QuestionnaireVersionRow>(
      `SELECT * FROM category_questionnaire_versions
       WHERE category_config_id = $1 AND questionnaire_type = $2 AND status = 'ACTIVE'
         AND (effective_until IS NULL OR effective_until > now())
       ORDER BY version DESC LIMIT 1`,
      [categoryConfigId, type]
    );
    if (rows.length === 0) {
      throw new Error(`Nenhuma versão ativa de questionário ${type} para a categoria ${categoryConfigId}`);
    }
    return rows[0];
  }

  async getFields(client: PoolClient, questionnaireVersionId: string): Promise<QuestionnaireFieldRow[]> {
    const { rows } = await client.query<QuestionnaireFieldRow>(
      `SELECT * FROM category_questionnaire_fields WHERE questionnaire_version_id = $1 ORDER BY order_index ASC`,
      [questionnaireVersionId]
    );
    return rows;
  }

  /** Publica uma NOVA versão (nunca sobrescreve) e a ativa, aposentando a anterior. */
  async publishNewVersion(
    client: PoolClient,
    input: {
      categoryConfigId: string;
      type: QuestionnaireType;
      fields: Array<{
        fieldKey: string;
        label: string;
        valueType: AnswerValueType;
        required?: boolean;
        orderIndex?: number;
        options?: unknown;
      }>;
    }
  ): Promise<QuestionnaireVersionRow> {
    const { rows: existing } = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM category_questionnaire_versions
       WHERE category_config_id = $1 AND questionnaire_type = $2`,
      [input.categoryConfigId, input.type]
    );
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    await client.query(
      `UPDATE category_questionnaire_versions SET status = 'RETIRED', effective_until = now()
       WHERE category_config_id = $1 AND questionnaire_type = $2 AND status = 'ACTIVE'`,
      [input.categoryConfigId, input.type]
    );

    const { rows } = await client.query<QuestionnaireVersionRow>(
      `INSERT INTO category_questionnaire_versions (category_config_id, questionnaire_type, version, status)
       VALUES ($1,$2,$3,'ACTIVE') RETURNING *`,
      [input.categoryConfigId, input.type, nextVersion]
    );
    const version = rows[0];

    for (const field of input.fields) {
      await client.query(
        `INSERT INTO category_questionnaire_fields
         (questionnaire_version_id, field_key, label, value_type, required, order_index, options)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          version.id,
          field.fieldKey,
          field.label,
          field.valueType,
          field.required ?? true,
          field.orderIndex ?? 0,
          field.options ? JSON.stringify(field.options) : null,
        ]
      );
    }

    return version;
  }
}

export const questionnaireService = new QuestionnaireService();
