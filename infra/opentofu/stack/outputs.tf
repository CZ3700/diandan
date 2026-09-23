output "deployment_manifest" {
  description = "Reference-only release identity. Does not attest to cloud deployment or runtime acceptance."
  value = {
    schemaVersion = 1
    environment   = var.environment_name
    region        = var.region
    backupRegion  = var.backup_region
    releaseCommit = var.release_commit
    images        = var.images
    cloudEvidence = false
  }
}
output "resource_references" {
  value = {
    database_endpoint      = module.data.endpoint
    database_master_secret = module.data.master_secret_arn
    buckets                = module.media.buckets
    distribution_id        = module.edge.distribution_id
    deployment_role_arn    = module.operations.deployment_role_arn
  }
}
output "invariants" {
  value = { network = module.network.invariants, data = module.data.invariants, media = module.media.invariants, compute = module.compute.invariants, edge = module.edge.invariants, operations = module.operations.invariants }
}
