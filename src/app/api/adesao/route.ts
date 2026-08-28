// Exemplo de Route Handler (Next.js) — camada de ENTREGA apenas.
// Nenhuma regra de negócio aqui: parsing de request, resolução de contexto
// verificado (nunca de headers não confiáveis) e delegação para o Command
// auditado. Ilustra o fluxo Route Handler → Command (auditoria obrigatória)
// → Service → Repository → Infra.

import { resolveAppContext, UnauthorizedError } from "@/lib/http-context";
import { createAdesaoCommand } from "@/modules/subscription/application/subscription.commands";

interface CreateAdesaoBody {
  treatmentId: string;
  planKey: string;
  idempotencyKey: string;
}

export async function POST(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await resolveAppContext(request.headers);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  if (ctx.role !== "PATIENT" || !ctx.patientId) {
    return Response.json({ error: "Apenas pacientes autenticados podem criar adesão" }, { status: 403 });
  }

  const body = (await request.json()) as CreateAdesaoBody;

  try {
    // patientId vem do CONTEXTO VERIFICADO (ctx.patientId), nunca do corpo
    // da requisição — o cliente não pode criar uma adesão em nome de outro paciente.
    const adesao = await createAdesaoCommand(ctx, {
      patientId: ctx.patientId,
      treatmentId: body.treatmentId,
      planKey: body.planKey,
      idempotencyKey: body.idempotencyKey,
    });
    return Response.json(adesao, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
